import {
  createInitialPlan,
  reviewPlan,
  planIssues,
} from "../services/planner.service.js";
import { PermanentError, RunStopped } from "../lib/errors.js";
import type { ResearchPlan, PlanReview } from "../zodSchema/research.schema.js";

export const createResearchPlan = async (
  question: string,
  depth: string,
  scope: string,
  signal?: AbortSignal,
  deps = { initial: createInitialPlan, review: reviewPlan },
  checkpoint?: (plan: ResearchPlan) => Promise<void>,
): Promise<ResearchPlan> => {
  if (signal?.aborted) {
    throw new RunStopped("Run stopped");
  }

  const plan = await deps.initial(question, depth, scope, signal);
  const issues = planIssues(plan, depth);

  if (issues.length) {
    throw new PermanentError(
      `Research plan could not be prepared: ${issues.join(" ")}`,
    );
  }

  await checkpoint?.(plan);

  let reviews: PlanReview[] = [];
  const warnings = [...(plan.warnings ?? [])];

  try {
    const review = await deps.review(question, plan, signal);
    reviews = [review];
    if (!review.valid) {
      warnings.push(
        ...review.issues,
        ...review.missingAngles,
        ...review.revisionInstructions,
      );
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new RunStopped("Run stopped");
    }

    warnings.push(
      "Automatic plan review was unavailable; inspect the queries before approving.",
    );
  }

  for (const resolution of plan.brief?.entityResolutions ?? []) {
    if (resolution.status === "uncertain") {
      warnings.push(`${resolution.requestedName}: ${resolution.note}`);
    }
  }

  const completed = { ...plan, reviews, warnings: [...new Set(warnings)] };
  await checkpoint?.(completed);
  return completed;
};
