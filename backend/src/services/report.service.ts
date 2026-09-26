import { z } from "zod";
import type { Analysis, Source } from "../../../shared/research.js";
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

export function renderReport(
  question: string,
  analysis: Analysis,
  sources: Source[],
) {
  const citations = (ids: string[]) =>
    [...new Set(ids)].map((id) => `[${id}]`).join(" ");
  return `# Research report\n\n${question}\n\n## Findings\n\n${analysis.findings.map((f) => `- ${f.claim} ${citations(f.evidence.map((e) => e.sourceId))}`).join("\n\n")}\n\n## Limitations and open questions\n\n${[...analysis.gaps, "This report is based on retrieved excerpts, not exhaustive full-document review."].map((g) => `- ${g}`).join("\n")}\n\n## Sources\n\n${sources
    .filter((s) =>
      analysis.findings.some((f) =>
        f.evidence.some((e) => e.sourceId === s.id),
      ),
    )
    .map((s) => `[${s.id}] ${s.title}\n${s.url}\nRetrieved: ${s.retrievedAt}`)
    .join("\n\n")}`;
}
