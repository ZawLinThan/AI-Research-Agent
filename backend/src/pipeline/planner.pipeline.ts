import {
  createInitialPlan,
  reviewPlan,
  revisePlan,
  planIssues,
} from "../services/planner.service.js";
import { PermanentError, RunStopped } from "../lib/errors.js";

export const createResearchPlan = async (
  question: string,
  depth: string,
  scope: string,
  signal?: AbortSignal,
  deps = { initial: createInitialPlan, review: reviewPlan, revise: revisePlan },
  checkpoint?: (
    plan: import("../zodSchema/research.schema.js").ResearchPlan,
  ) => Promise<void>,
) => {
  if (signal?.aborted) {
    throw new RunStopped("Run stopped");
  }

  let plan = await deps.initial(question, depth, scope, signal);
  console.log("Initial Plan is ", plan);

  const reviews: import("../zodSchema/research.schema.js").PlanReview[] = [];
  const inspect = async () => {
    const semantic = await deps.review(question, plan, signal);
    const issues = planIssues(plan, depth);
    const result = issues.length
      ? {
          ...semantic,
          valid: false,
          revisionInstructions: [
            ...issues,
            ...semantic.revisionInstructions,
          ].slice(0, 3),
        }
      : semantic;
    reviews.push(result);
    await checkpoint?.({ ...plan, reviews });
    return result;
  };
  let review = await inspect();
  console.log("Initial Review says ", review);

  for (let count = 0; !review.valid && count < 1; count++) {
    if (signal?.aborted) {
      throw new RunStopped("Run stopped");
    }

    plan = await deps.revise(question, depth, scope, plan, review, signal);
    console.log(`${count + 1} revise gives `, plan);

    review = await inspect();
    console.log("Review for the prev revise ", review);
  }
  if (!review.valid)
    throw new PermanentError(
      `Research plan failed review after one revision: ${[...new Set([...review.revisionInstructions, ...review.issues])].slice(0, 3).join(" ") || "The reviewer found unresolved intent or coverage issues."}`,
    );
  return { ...plan, reviews };
};
