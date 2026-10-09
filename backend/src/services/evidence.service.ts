import { normalizeEvidenceSelection } from "../lib/modelOutputNormalization.js";
import { z } from "zod";
import { createHash } from "node:crypto";

import { structured } from "../config/openRouterAI.js";
import { Source } from "../types/research.js";
import { Analysis, analysisSchema } from "../zodSchema/research.schema.js";

export function sourceId(url: string) {
  return "S" + createHash("sha256").update(url).digest("hex").slice(0, 12);
}

export function canonicalUrl(value: string) {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Invalid source URL");
  u.hash = "";
  for (const key of [...u.searchParams.keys()])
    if (key.startsWith("utm_") || ["fbclid", "gclid"].includes(key))
      u.searchParams.delete(key);
  u.searchParams.sort();
  return u.href;
}

export function selectSources(
  sources: Source[],
  limit = Number.POSITIVE_INFINITY,
) {
  const map = new Map<string, Source>();
  
  for (const s of sources) {
    let url: string;

    try {
      url = canonicalUrl(s.url);
    } catch {
      continue;
    }
    const previous = map.get(url);
    map.set(url, {
      ...s,
      id: sourceId(url),
      url,
      queryIds: [...new Set([...(previous?.queryIds || []), ...(s.queryIds || [])])],
      queries: [...new Set([...(previous?.queries || []), ...s.queries])],
      highlights: [
        ...new Set([...(previous?.highlights || []), ...s.highlights]),
      ]
        .slice(0, 8)
        .map((v) => v.slice(0, 1500)),
    });
  }
  return [...map.values()]
    .sort((a, b) => b.queries.length - a.queries.length)
    .slice(0, limit);
}

export function filterAnalysisFindings(
  analysis: Analysis,
  keep: (finding: Analysis["findings"][number], index: number) => boolean,
): Analysis {
  const remap = new Map<number, number>();
  const findings = analysis.findings.filter((finding, index) => {
    if (!keep(finding, index)) return false;
    remap.set(index, remap.size);
    return true;
  });
  const indexes = (values: number[]) =>
    values.flatMap((index) => (remap.has(index) ? [remap.get(index)!] : []));
  return {
    ...analysis,
    findings,
    ...(analysis.topics
      ? {
          topics: analysis.topics
            .map((topic) => ({
              ...topic,
              findingIndexes: indexes(topic.findingIndexes),
            }))
            .filter((topic) => topic.findingIndexes.length),
        }
      : {}),
    ...(analysis.disagreements
      ? {
          disagreements: analysis.disagreements
            .map((disagreement) => ({
              ...disagreement,
              findingIndexes: indexes(disagreement.findingIndexes),
            }))
            .filter((disagreement) => disagreement.findingIndexes.length > 1),
        }
      : {}),
  };
}

export function groundedFindings(
  analysis: Analysis,
  sources: Source[],
): Analysis {
  const map = new Map(sources.map((s) => [s.id, s]));
  return filterAnalysisFindings(
    analysis,
    (finding) =>
      finding.evidence.length > 0 &&
      finding.evidence.every((e) =>
        map.get(e.sourceId)?.highlights.some((h) => h.includes(e.quote)),
      ),
  );
}

export async function analyzeEvidence(
  question: string,
  sources: Source[],
  signal?: AbortSignal,
) {
  const excerpts = sources.slice(0, 10).flatMap((source) =>
    source.highlights
      .filter((text) => text.trim().length >= 15)
      .slice(0, 2)
      .map((text, index) => ({
        excerptId: `${source.id}:${index}`,
        sourceId: source.id,
        title: source.title.slice(0, 120),
        text: text.slice(0, 900),
      })),
  );

  // Share a bounded evidence budget fairly across sources, retaining longer
  // excerpts when fewer sources are available.
  const perExcerpt = Math.min(
    900,
    Math.floor(6500 / Math.max(1, Math.min(10, excerpts.length))),
  );
  for (const excerpt of excerpts)
    excerpt.text = excerpt.text.slice(0, perExcerpt);

  if (!excerpts.length)
    return {
      findings: [],
      gaps: ["No usable excerpts were supplied."],
      followUpQueries: [],
    };

  const selectionSchema = z.object({
    findings: z
      .array(
        z.object({
          claim: z.string().min(1).max(600),
          excerptIds: z
            // Keep the provider-facing schema simple. OpenRouter can emit values
            // outside a dynamically generated enum even when given the IDs.
            // We validate every ID against this request's excerpts below.
            .array(z.string().min(1).max(100))
            .min(1)
            .max(2),
        }),
      )
      .max(6),
    gaps: analysisSchema.shape.gaps,
  });

  const result: z.infer<typeof selectionSchema> = { findings: [], gaps: [] };
  for (let offset = 0; offset < excerpts.length; offset += 10) {
    const batchExcerpts = excerpts.slice(offset, offset + 10);
    const suppliedIds = new Set(
      batchExcerpts.map((excerpt) => excerpt.excerptId),
    );
    // Preserve the existing source-ID fallback only for unambiguous sources.
    for (const excerpt of batchExcerpts) {
      if (
        batchExcerpts.filter((other) => other.sourceId === excerpt.sourceId)
          .length === 1
      )
        suppliedIds.add(excerpt.sourceId);
    }
    const batch = await structured(
      'Analyze the supplied excerpts. Return {"findings":[{"claim":"a precise factual claim","excerptIds":["provided excerpt ID"]}],"gaps":["unanswered question or contradiction"]}. For excerptIds, copy the excerptId value exactly from the supplied excerpts; do not use sourceId or invent IDs. Aim for 4–6 distinct, useful findings from this batch when the evidence supports them, each under 600 characters. Start with findings that directly answer the question, then cover specific dimensions with concrete facts, relevant numbers, dates, examples, comparisons, and qualifications. Write complete, plain-English sentences; explain technical terms and remove extraction markup. Do not pad or repeat findings to meet a count. excerptIds must be an array of exactly one or two distinct strings, never more than two. Select the strongest evidence that directly supports the whole claim. Do not generate quotations. If evidence is inadequate return fewer or no findings. Identify conflicting evidence and limitations. gaps must be an array of at most five plain strings, each under 300 characters; never objects, arrays, nulls, or numbers. Example: "gaps":["Comparable figures for the same year were not available."]. Return only findings and gaps; include both fields even when empty. Follow-up searches have already been handled by the search pipeline.',
      { question, excerpts: batchExcerpts },
      selectionSchema,
      signal,
      2000,
      (value) => normalizeEvidenceSelection(value, suppliedIds),
    );
    result.findings.push(...batch.findings);
    result.gaps.push(...batch.gaps);
  }
  result.gaps = [...new Set(result.gaps)].slice(0, 5);
  result.findings = result.findings
    .filter(
      (finding, index, all) =>
        all.findIndex(
          (other) => other.claim.toLowerCase() === finding.claim.toLowerCase(),
        ) === index,
    )
    .slice(0, 12);

  const byId = new Map(excerpts.map((e) => [e.excerptId, e]));
  const bySourceId = new Map(
    excerpts
      .filter(
        (e) =>
          excerpts.filter((other) => other.sourceId === e.sourceId).length ===
          1,
      )
      .map((e) => [e.sourceId, e]),
  );
  const supportedFindings = result.findings.flatMap((finding) => {
    const evidence = finding.excerptIds
      // Some model responses cite the supplied sourceId instead of excerptId.
      // Fall back only when a source has exactly one excerpt.
      .map((id) => byId.get(id) ?? bySourceId.get(id))
      .filter((excerpt): excerpt is (typeof excerpts)[number] => !!excerpt)
      .map((excerpt) => ({ sourceId: excerpt.sourceId, quote: excerpt.text }));
    // Unknown IDs are treated as unsupported evidence, not as a failed run.
    return evidence.length ? [{ claim: finding.claim, evidence }] : [];
  });

  const groundedFindingsResult: Analysis = groundedFindings(
    {
      ...result,
      // Retain the stored Analysis shape without asking the model for unused queries.
      followUpQueries: [],
      findings: supportedFindings,
    },
    sources,
  );

  console.log("Grounded Finding Results: ", groundedFindingsResult);
  return groundedFindingsResult;
}
