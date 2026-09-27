import { ModelOutputError } from "../lib/errors.js";
import { z } from "zod";
import type { Analysis, Source } from "../../../shared/research.js";
import type { ReportLayout } from "../types/research.js";
import { structured } from "../config/openRouterAI.js";
import { groundedFindings } from "./evidence.service.js";

export async function verifyFindings(
  question: string,
  analysis: Analysis,
  sources: Source[],
  signal?: AbortSignal,
) {
  const checked = groundedFindings(analysis, sources);
  const supported = new Set<number>();
  // Bound each verification request as findings become more detailed.
  for (let offset = 0; offset < checked.findings.length; offset += 4) {
    const batch = checked.findings.slice(offset, offset + 4);
    const verdict = await structured(
      'Review claims against quoted evidence. Return {"supported":[0,1]} containing ONLY zero-based indices within this batch of claims fully supported by their quoted evidence. Reject misleading interpretations, unsupported comparisons, causal leaps and stale claims framed as current. Do not add claims.',
      { question, findings: batch },
      z.object({ supported: z.array(z.number().int().nonnegative()).max(4) }),
      signal,
      800,
    );
    for (const index of verdict.supported) {
      if (index < batch.length) supported.add(offset + index);
    }
  }
  return {
    ...checked,
    findings: checked.findings.filter((_, index) => supported.has(index)),
  };
}

const reportLayoutSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  overview: z.array(z.number().int().nonnegative()).min(1).max(12),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(80),
        findingIndexes: z.array(z.number().int().nonnegative()).max(12),
      }),
    )
    .max(6),
});

export async function createReportLayout(
  question: string,
  analysis: Analysis,
  signal?: AbortSignal,
): Promise<ReportLayout> {
  const result = await structured(
    'Write a research report introduction and organize the already-verified findings. Return {"summary":"A short, direct answer in fresh wording.","overview":[0,1],"sections":[{"heading":"Specific topic","findingIndexes":[0,1]}]}. summary must be one cohesive paragraph of 2–4 sentences that directly answers the question and synthesizes the main takeaways across ALL topic sections. Paraphrase and connect the findings in your own words; do not copy, concatenate, or lightly rearrange sentences from the findings or bullet sections. Preserve important qualifications and uncertainty, including material gaps. Do not introduce facts, causal claims, rankings, or recommendations unsupported by the supplied findings. No headings, bullets, or citation markers inside summary. overview must list the zero-based indexes of all findings supporting the summary, for citations. Group every finding into specific, descriptive sections with two to four related bullets where evidence permits. The sections only arrange finding indexes; do not rewrite findings or invent headings that assert unsupported conclusions. Avoid empty sections and duplicate indexes.',
    {
      question,
      gaps: analysis.gaps,
      findings: analysis.findings.map((finding, index) => ({
        index,
        claim: finding.claim,
      })),
    },
    reportLayoutSchema,
    signal,
    1800,
  );

  const validIndexes = new Set(analysis.findings.map((_, index) => index));
  const uniqueValid = (indexes: number[]) =>
    [...new Set(indexes)].filter((index) => validIndexes.has(index));
  const assigned = new Set<number>();
  const sections = result.sections.flatMap(({ heading, findingIndexes }) => {
    const indexes = uniqueValid(findingIndexes).filter(
      (index) => !assigned.has(index),
    );
    indexes.forEach((index) => assigned.add(index));
    return indexes.length
      ? [
          {
            heading: heading.replace(/[\r\n]/g, " "),
            findingIndexes: indexes,
          },
        ]
      : [];
  });
  const remaining = [...validIndexes].filter((index) => !assigned.has(index));
  if (remaining.length)
    sections.push({
      heading: "Additional findings",
      findingIndexes: remaining,
    });

  const overview = uniqueValid(result.overview);
  if (!overview.length)
    throw new ModelOutputError(
      "The report summary has no valid supporting findings.",
      "schema_validation",
      [{ path: "overview", code: "invalid_reference" }],
    );
  const summary = result.summary.replace(/\s+/g, " ").trim();
  const review = await structured(
    'Check this opening summary against the verified findings and gaps. Return {"valid":true} only if it directly answers the question, fairly synthesizes the main topics, preserves important uncertainty, and uses fresh wording rather than copying or concatenating finding sentences. Shared names and technical terms are fine. Every factual assertion must be supported by the findings whose index appears in summaryFindingIndexes. Reject new facts, exaggerated conclusions, and unsupported recommendations.',
    {
      question,
      summary,
      summaryFindingIndexes: overview,
      findings: analysis.findings.map((finding, index) => ({
        index,
        claim: finding.claim,
      })),
      gaps: analysis.gaps,
    },
    z.object({ valid: z.boolean() }),
    signal,
    300,
  );
  if (!review.valid)
    throw new ModelOutputError(
      "The opening summary did not pass the support and paraphrase check.",
      "schema_validation",
      [{ path: "summary", code: "unsupported_or_unfaithful_summary" }],
    );

  return { summary, overview, sections };
}

export function renderReport(
  question: string,
  analysis: Analysis,
  sources: Source[],
  layout?: ReportLayout,
) {
  const citations = (ids: string[]) =>
    [...new Set(ids)].map((id) => `[${id}]`).join(" ");
  const finding = (index: number) => {
    const value = analysis.findings[index];
    return value
      ? `${value.claim} ${citations(value.evidence.map((e) => e.sourceId))}`
      : "";
  };
  const overviewIndexes = layout?.overview.length
    ? layout.overview
    : analysis.findings.slice(0, 2).map((_, index) => index);
  const overview = layout?.summary
    ? `${layout.summary} ${citations(overviewIndexes.flatMap((index) => analysis.findings[index]?.evidence.map((e) => e.sourceId) ?? []))}`
    : overviewIndexes.map(finding).filter(Boolean).join(" ");
  const used = new Set<number>();
  const sections = (
    layout?.sections ?? [
      {
        heading: "Key findings",
        findingIndexes: analysis.findings.map((_, i) => i),
      },
    ]
  )
    .map(({ heading, findingIndexes }) => {
      const bullets = findingIndexes
        .filter((index) => !used.has(index))
        .map((index) => {
          used.add(index);
          const text = finding(index);
          return text ? `- ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");
      return bullets ? `## ${heading}\n\n${bullets}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const limitations = [...analysis.gaps];
  limitations.push(
    "Findings are based on retrieved source excerpts; sources may use different definitions, measures, or time periods.",
  );
  return `# Question: ${question}\n\n${overview}\n\n${sections}\n\n## Limitations and open questions\n\n${limitations.map((g) => `- ${g}`).join("\n")}\n\n## Sources\n\n${sources
    .filter((s) =>
      analysis.findings.some((f) =>
        f.evidence.some((e) => e.sourceId === s.id),
      ),
    )
    .map((s) => `[${s.id}] ${s.title}\n${s.url}\nRetrieved: ${s.retrievedAt}`)
    .join("\n\n")}`;
}
