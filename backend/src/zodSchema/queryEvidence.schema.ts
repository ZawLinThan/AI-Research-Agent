import { z } from "zod";

const evidence = z.object({
  sourceId: z.string().min(1),
  quote: z.string().min(15).max(450),
});
export const querySummarySchema = z.object({
  findings: z
    .array(
      z.object({
        topic: z.string().min(1).max(80),
        claim: z.string().min(1).max(300),
        evidence: z.array(evidence).min(1).max(3),
      }),
    )
    .max(4),
  disagreements: z
    .array(
      z.object({
        topic: z.string().min(1).max(100),
        findingIndexes: z.array(z.number().int().nonnegative()).min(2).max(4),
      }),
    )
    .max(3),
  unansweredQuestions: z.array(z.string().min(1).max(200)).max(3),
  needsContext: z
    .array(
      z.object({
        sourceId: z.string().min(1),
        reason: z.string().min(1).max(200),
      }),
    )
    // A summary considers up to ten sources. Preserve context requirements for
    // all of them rather than failing or silently dropping unresolved sources.
    .max(10),
});
export type QuerySummary = z.infer<typeof querySummarySchema>;
export type EvidenceCheckpoint = {
  aliases?: Record<string, string>;
  summaries: Record<string, QuerySummary>;
  drafts?: Record<string, QuerySummary>;
  documents?: Record<string, string>;
};
