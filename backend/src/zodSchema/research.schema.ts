import { z } from "zod";

export const requestSchema = z.object({
  question: z.string().trim().min(10).max(5000),
  depth: z.enum(["Deep research", "Quick overview"]).default("Deep research"),
  scope: z
    .enum(["Web & academic", "Web", "Academic"])
    .default("Web & academic"),
  requestId: z.string().uuid(),
});

export type ResearchInput = z.infer<typeof requestSchema>;

export const planSchema = z.object({
  queries: z.array(z.string().trim().min(3).max(300)).min(1).max(6),
});

export type ResearchPlan = z.infer<typeof planSchema>;

export const planReviewSchema = z.object({
  valid: z.boolean(),
  score: z.object({
    intentAlignment: z.number().min(0).max(1),
    coverage: z.number().min(0).max(1),
    diversity: z.number().min(0).max(1),
    searchability: z.number().min(0).max(1),
    freshness: z.number().min(0).max(1),
  }),
  issues: z.array(z.string().max(200)).max(3),
  missingAngles: z.array(z.string().max(200)).max(3),
  revisionInstructions: z.array(z.string().max(200)).max(3),
});

export type PlanReview = z.infer<typeof planReviewSchema>;

export const findingSchema = z.object({
  claim: z.string().min(1).max(1500),
  evidence: z
    .array(
      z.object({ sourceId: z.string(), quote: z.string().min(15).max(1200) }),
    )
    .min(1)
    .max(6),
});
export const analysisSchema = z.object({
  findings: z.array(findingSchema).max(60),
  gaps: z.array(z.string().max(300)).max(30),
  followUpQueries: z.array(z.string().min(3).max(300)).max(1),
  topics: z
    .array(
      z.object({
        heading: z.string(),
        findingIndexes: z.array(z.number().int().nonnegative()),
      }),
    )
    .optional(),
  disagreements: z
    .array(
      z.object({
        topic: z.string(),
        findingIndexes: z.array(z.number().int().nonnegative()),
      }),
    )
    .optional(),
});

export type Analysis = z.infer<typeof analysisSchema>;
