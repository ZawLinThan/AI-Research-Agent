import { z } from "zod";

export const sourcesSchema = z.object({
  results: z.array(
    z.object({
      url: z.string().url(),
      title: z.string().nullish(),
      highlights: z.array(z.string()).optional(),
    }),
  ),
});

export type Sources = z.infer<typeof sourcesSchema>;

export const searchReviewSchema = z.object({
  sufficient: z.boolean(),

  relevanceScore: z.number().min(0).max(1),
  coverageScore: z.number().min(0).max(1),
  sourceQualityScore: z.number().min(0).max(1),

  missingEvidence: z.array(z.string().max(200)).max(3),
  weakAreas: z.array(z.string().max(200)).max(3),
  followUpQueries: z.array(z.string().trim().min(3).max(300)).max(2),

  reason: z.string().min(1).max(400),
});

export type SearchReview = z.infer<typeof searchReviewSchema>;
