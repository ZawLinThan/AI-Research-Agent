import "dotenv/config";
import { z } from "zod";

// Deep research: 6 planner calls + 10 searches + 3 search reviews + analysis +
// verification + report layout = 22 calls. One correction per model call raises
// this to 34. The default leaves 6 calls for transient failures across attempts.
export const maxProviderCalls = z.coerce
  .number()
  .int()
  .positive()
  .default(40)
  .parse(process.env.RESEARCH_MAX_PROVIDER_CALLS);

// Set these to the limits for the Groq organization/model used by this deployment.
export const groqTokensPerMinute = z.coerce
  .number()
  .int()
  .positive()
  .default(8000)
  .parse(process.env.GROQ_TOKENS_PER_MINUTE);
  
export const groqRequestsPerMinute = z.coerce
  .number()
  .int()
  .positive()
  .default(30)
  .parse(process.env.GROQ_REQUESTS_PER_MINUTE);

// Avoid spending most of a run's deadline waiting behind another local run.
export const researchWorkerConcurrency = z.coerce
  .number()
  .int()
  .positive()
  .default(1)
  .parse(process.env.RESEARCH_WORKER_CONCURRENCY);
