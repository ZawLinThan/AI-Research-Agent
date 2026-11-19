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

export const researchBriefSchema = z
  .object({
    originalQuestion: z.string(),
    intent: z.string(),
    entities: z.array(z.string()),
    domain: z.enum([
      "technology",
      "healthcare",
      "energy", 
      "consumer", 
      "industrial", 
      "financial", 
      "materials",
      "real_estate",
      "telecom", 
      "general",
    ]),
    answerShape: z.enum([
      "comparison",
      "overview",
      "ranking",
      "causal",
      "trajectory",
      "definition",
    ]),
    currentDate: z.string(),
    entityResolutions: z
      .array(
        z.object({
          requestedName: z.string(),
          canonicalName: z.string(),
          ticker: z.string().optional(),
          note: z.string(),
          sourceUrl: z.string().url().optional(),
          status: z.enum(["verified", "uncertain"]),
        }),
      )
      .optional(),
    periodPolicy: z
      .object({
        mode: z.enum(["shared", "as_of", "open"]),
        period: z.string().optional(),
        rationale: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((brief, ctx) => {
    const needsShared = brief.answerShape === "comparison";
    const needsAsOf = brief.answerShape === "ranking";

    if (needsShared || needsAsOf) {
      const expectedMode = needsShared ? "shared" : "as_of";
      if (brief.periodPolicy?.mode !== expectedMode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["periodPolicy", "mode"],
          message: `${brief.answerShape} requires periodPolicy.mode = "${expectedMode}".`,
        });
      }
      if (!brief.periodPolicy?.period) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["periodPolicy", "period"],
          message: `${brief.answerShape} requires an explicit period token (e.g. "FY2025", "Q3-2026", "2026-11-18").`,
        });
      }
    }

    // Shapes that don't need a period must not claim a "shared" one.
    if (!needsShared && !needsAsOf && brief.periodPolicy?.mode === "shared") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodPolicy", "mode"],
        message: `periodPolicy.mode = "shared" is only valid for comparison questions.`,
      });
    }
  });

export type ResearchBrief = z.infer<typeof researchBriefSchema>;

export const plannedQuerySchema = z.object({
  id: z.string(),
  query: z.string().trim().min(3).max(300),
  informationNeed: z.string().min(1),
  entities: z.array(z.string()),
  targetPeriod: z.string().optional(),
  metric: z.string().trim().min(1).max(120).optional(),
});

export type PlannedQuery = z.infer<typeof plannedQuerySchema>;

// Keep string queries for the existing plan editor and old checkpoints.
export const planSchema = z.object({
  queries: z.array(z.string().trim().min(3).max(300)).min(1).max(12),
  plannedQueries: z.array(plannedQuerySchema).max(12).optional(),
  brief: researchBriefSchema.optional(),
  reviews: z.array(z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
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
