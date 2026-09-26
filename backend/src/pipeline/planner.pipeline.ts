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
  if (signal?.aborted) {
    throw new RunStopped("Run stopped");
  }

  let plan = await deps.initial(question, depth, scope, signal);
  console.log("Initial Plan is ",  plan); 

  let review = await deps.review(question, plan, signal);
  console.log("Initial Review says ", review)

  for (let count = 0; !review.valid && count < 2; count++) {
    if (signal?.aborted) {
      throw new RunStopped("Run stopped");
    }

    plan = await deps.revise(question, depth, scope, plan, review, signal);
    console.log(`${count+1} revise gives `, plan); 

    review = await deps.review(question, plan, signal);
    console.log("Review for the prev revise ", review); 
  }
  return plan;
};
