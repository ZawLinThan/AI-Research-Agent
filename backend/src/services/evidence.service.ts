import { z } from "zod";
import { createHash } from "node:crypto";

import { structured } from "../config/groqAI.js";
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
  return u.href;
}
export function selectSources(sources: Source[], limit = 10) {
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
      queries: [...new Set([...(previous?.queries || []), ...s.queries])],
      highlights: [
        ...new Set([...(previous?.highlights || []), ...s.highlights]),
      ]
        .slice(0, 2)
        .map((v) => v.slice(0, 900)),
    });
  }
  return [...map.values()]
    .filter((s) => s.highlights.some((h) => h.trim().length > 20))
    .sort((a, b) => b.queries.length - a.queries.length)
    .slice(0, limit);
}
export function groundedFindings(
  analysis: Analysis,
  sources: Source[],
): Analysis {
  const map = new Map(sources.map((s) => [s.id, s]));

  return {
    ...analysis,
    findings: analysis.findings.filter((f) =>
      f.evidence.every((e) =>
        map.get(e.sourceId)?.highlights.some((h) => h.includes(e.quote)),
      ),
    ),
  };
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
        text: text.slice(0, 450),
      })),
  );

  console.log("Excerpts: ",excerpts); 

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
          claim: z.string().min(1).max(400),
          excerptIds: z
            // Keep the provider-facing schema simple. Groq can emit values
            // outside a dynamically generated enum even when given the IDs.
            // We validate every ID against this request's excerpts below.
            .array(z.string().min(1).max(100))
            .min(1)
            .max(2),
        }),
      ),
      //.max(5),
    gaps: analysisSchema.shape.gaps,
  });
  
  const result = await structured(
    'Analyze the supplied excerpts. Return {"findings":[{"claim":"a precise factual claim","excerptIds":["provided excerpt ID"]}],"gaps":["unanswered question or contradiction"]}. For excerptIds, copy the excerptId value exactly from the supplied excerpts; do not use sourceId or invent IDs. Maximum 5 concise findings, each claim under 400 characters. Select one or two excerpt IDs that directly support each claim. Do not generate quotations. If evidence is inadequate return fewer or no findings. Identify conflicting evidence and limitations. Return only findings and gaps; include both fields even when empty. Follow-up searches have already been handled by the search pipeline.',
    { question, excerpts },
    selectionSchema,
    signal,
  );

  const byId = new Map(excerpts.map((e) => [e.excerptId, e]));
  const bySourceId = new Map(excerpts.map((e) => [e.sourceId, e]));
  const supportedFindings = result.findings.flatMap((finding) => {
    const evidence = finding.excerptIds
      // Some model responses cite the supplied sourceId instead of excerptId.
      // Each source contributes at most one excerpt here, so this is unambiguous.
      .map((id) => byId.get(id) ?? bySourceId.get(id))
      .filter((excerpt): excerpt is (typeof excerpts)[number] => !!excerpt)
      .map((excerpt) => ({ sourceId: excerpt.sourceId, quote: excerpt.text }));
    // Unknown IDs are treated as unsupported evidence, not as a failed run.
    return evidence.length ? [{ claim: finding.claim, evidence }] : [];
  });

  const groundedFindingsResult : Analysis =  groundedFindings(
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
