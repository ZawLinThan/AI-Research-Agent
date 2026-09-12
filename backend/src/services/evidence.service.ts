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
  const excerpts = sources.flatMap((source) =>
    source.highlights
      .filter((text) => text.trim().length >= 15)
      .map((text, index) => ({
        excerptId: `${source.id}:${index}`,
        sourceId: source.id,
        title: source.title,
        text,
      })),
  );
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
            .array(z.enum(excerpts.map((e) => e.excerptId)))
            .min(1)
            .max(2),
        }),
      )
      .max(5),
    gaps: analysisSchema.shape.gaps,
    followUpQueries: analysisSchema.shape.followUpQueries,
  });
  const result = await structured(
    'Analyze the supplied excerpts. Return {"findings":[{"claim":"a precise factual claim","excerptIds":["provided excerpt ID"]}],"gaps":["unanswered question or contradiction"],"followUpQueries":["at most one useful search query"]}. Maximum 5 concise findings, each claim under 400 characters. Select one or two excerpt IDs that directly support each claim. Do not generate quotations. If evidence is inadequate return fewer or no findings. Identify conflicting evidence and limitations.',
    { question, excerpts },
    selectionSchema,
    signal,
  );
  const byId = new Map(excerpts.map((e) => [e.excerptId, e]));
  return groundedFindings(
    {
      ...result,
      findings: result.findings.map((f) => ({
        claim: f.claim,
        evidence: f.excerptIds.map((id) => {
          const excerpt = byId.get(id)!;
          return { sourceId: excerpt.sourceId, quote: excerpt.text };
        }),
      })),
    },
    sources,
  );
}
