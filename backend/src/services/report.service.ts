import { z } from "zod";
import type { Analysis, Source } from "../../../shared/research.js";
import type { ReportLayout } from "../types/research.js";
import { structured } from "../config/groqAI.js";
import { groundedFindings } from "./evidence.service.js";

export async function verifyFindings(
  question: string,
  analysis: Analysis,
  sources: Source[],
  signal?: AbortSignal,
) {
  const checked = groundedFindings(analysis, sources);
  const verdict = await structured(
    'Review claims against quoted evidence. Return {"supported":[0,1]} containing ONLY zero-based indices of claims fully supported by their quoted evidence. Reject misleading interpretations, unsupported comparisons, causal leaps and stale claims framed as current. Do not add claims.',
    { question, findings: checked.findings },
    z.object({ supported: z.array(z.number().int().nonnegative()).max(12) }),
    signal,
    800,
  );
  return {
    ...checked,
    findings: checked.findings.filter((_, i) => verdict.supported.includes(i)),
  };
}

const reportLayoutSchema = z.object({
  overview: z.array(z.number().int().nonnegative()).max(3),
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
    'Organize the supplied already-verified findings into a readable web-search-style research overview. Return {"overview":[0],"sections":[{"heading":"Market leaders","findingIndexes":[0]}]}. Select up to three finding indexes for the overview, and group every finding into a concise, useful section. Use headings that reflect the actual dimensions in the supplied findings. Do not add, rewrite, rank, or infer facts; only arrange the supplied findings. Each finding index must be copied from its zero-based position. Do not create empty sections.',
    {
      question,
      findings: analysis.findings.map((finding, index) => ({
        index,
        claim: finding.claim,
      })),
    },
    reportLayoutSchema,
    signal,
    1000,
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

  return { overview: uniqueValid(result.overview), sections };
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
      ? `- ${value.claim} ${citations(value.evidence.map((e) => e.sourceId))}`
      : "";
  };
  const overview = layout?.overview
    .map(finding)
    .filter(Boolean)
    .join("\n");
  const used = new Set(layout?.overview ?? []);
  const sections = (layout?.sections ?? [
    {
      heading: "Key findings",
      findingIndexes: analysis.findings.map((_, i) => i),
    },
  ])
    .map(({ heading, findingIndexes }) => {
      const bullets = findingIndexes
        .filter((index) => !used.has(index))
        .map((index) => {
          used.add(index);
          return finding(index);
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
  return `# Research report\n\n${question}\n\n${overview ? `## Overview\n\n${overview}\n\n` : ""}${sections}\n\n## Limitations and open questions\n\n${limitations.map((g) => `- ${g}`).join("\n")}\n\n## Sources\n\n${sources
    .filter((s) =>
      analysis.findings.some((f) =>
        f.evidence.some((e) => e.sourceId === s.id),
      ),
    )
    .map((s) => `[${s.id}] ${s.title}\n${s.url}\nRetrieved: ${s.retrievedAt}`)
    .join("\n\n")}`;
}
