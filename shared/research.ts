// Compatibility exports for consumers still using the shared contract after the backend refactor.
export {
  requestSchema,
  planSchema,
  planReviewSchema,
  findingSchema,
  analysisSchema,
} from "../backend/src/zodSchema/research.schema.js";
export type {
  ResearchInput,
  ResearchPlan,
  PlanReview,
  Analysis,
} from "../backend/src/zodSchema/research.schema.js";
export { statuses, terminal } from "../backend/src/types/research.js";
export type {
  Source,
  ResearchStatus,
  Checkpoint,
  ResearchProject,
} from "../backend/src/types/research.js";
