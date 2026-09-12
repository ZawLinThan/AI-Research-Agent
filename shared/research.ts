import { z } from "zod";
export const statuses = [
  "pending",
  "planning",
  "searching",
  "analyzing",
  "generating_report",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ResearchStatus = (typeof statuses)[number];

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
  issues: z.array(z.string()),
  missingAngles: z.array(z.string()),
  revisionInstructions: z.array(z.string()),
})

export type PlanReview = z.infer<typeof planReviewSchema>;

export type Source = {
  id: string;
  url: string;
  title: string;
  highlights: string[];
  queries: string[];
  retrievedAt: string;
};
export const findingSchema = z.object({
  claim: z.string().min(1).max(1500),
  evidence: z
    .array(
      z.object({ sourceId: z.string(), quote: z.string().min(15).max(1200) }),
    )
    .min(1)
    .max(3),
});
export const analysisSchema = z.object({
  findings: z.array(findingSchema).max(12),
  gaps: z.array(z.string().max(300)).max(5),
  followUpQueries: z.array(z.string().min(3).max(300)).max(1),
});
export type Analysis = z.infer<typeof analysisSchema>;
export type Checkpoint = {
  plan?: ResearchPlan;
  searches?: Record<string, Source[]>;
  sources?: Source[];
  analysis?: Analysis;
  followUpDone?: boolean;
  verified?: Analysis;
  calls?: number;
};
export type ResearchProject = {
  id: string;
  question: string;
  status: ResearchStatus;
  depth: ResearchInput["depth"];
  scope: ResearchInput["scope"];
  progress: number;
  report: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  sources?: Source[];
  researchPlan?: ResearchPlan | null;
};
export const terminal = (status: string) =>
  ["completed", "failed", "cancelled"].includes(status);
