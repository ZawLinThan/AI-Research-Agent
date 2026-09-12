import {
  createInitialPlan,
  reviewPlan,
  revisePlan,
} from "../services/planner.service.js";
import { RunStopped } from "../lib/errors.js";

export const createResearchPlan = async (
  question: string,
  depth: string,
  scope: string,
  signal?: AbortSignal,
  deps = { initial: createInitialPlan, review: reviewPlan, revise: revisePlan },
) => {
  if (signal?.aborted) throw new RunStopped("Run stopped");
  let plan = await deps.initial(question, depth, scope, signal);
  let review = await deps.review(question, plan, signal);
  for (let count = 0; !review.valid && count < 2; count++) {
    if (signal?.aborted) throw new RunStopped("Run stopped");
    plan = await deps.revise(question, depth, scope, plan, review, signal);
    review = await deps.review(question, plan, signal);
  }
  return plan;
};
