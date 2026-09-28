import "dotenv/config";
import { z } from "zod";

// Multiple query summaries, context retrieval, semantic deduplication, merging,
// and verification each reserve actual provider calls, including corrections.
export const researchTimeBudgetMs = 60 * 60_000;
export const researchTimeBudgetMessage =
  "Research exceeded its sixty-minute time budget.";
export const maxProviderCalls = z.coerce
  .number()
  .int()
  .positive()
  .default(140)
  .parse(process.env.RESEARCH_MAX_PROVIDER_CALLS);

// Set these to the limits for the OpenRouter organization/model used by this deployment.
export const openRouterTokensPerMinute = z.coerce
  .number()
  .int()
  .positive()
  .default(8000)
  .parse(process.env.OPENROUTER_TOKENS_PER_MINUTE);

export const openRouterRequestsPerMinute = z.coerce
  .number()
  .int()
  .positive()
  .default(30)
  .parse(process.env.OPENROUTER_REQUESTS_PER_MINUTE);

// Avoid spending most of a run's deadline waiting behind another local run.
export const researchWorkerConcurrency = z.coerce
  .number()
  .int()
  .positive()
  .default(1)
  .parse(process.env.RESEARCH_WORKER_CONCURRENCY);
