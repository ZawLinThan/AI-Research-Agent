import { PlanReview, ResearchPlan } from "../../../shared/research"
import { createInitialPlan, reviewPlan, revisePlan } from "../services/planner.service";

export type PlannerPipelineDeps = {
    initialPlan: (
        question: string,
        depth: string,
        scope: string,
        signal?: AbortSignal,
    ) => Promise<ResearchPlan>,
    reviewPlan: (
        question: string,
        plan: ResearchPlan,
        signal?: AbortSignal,
    ) => Promise<PlanReview>;
    revisePlan: (
        question: string,
        depth: string,
        scope: string,
        originalPlan: ResearchPlan,
        review: PlanReview,
        signal?: AbortSignal,
    ) => Promise<ResearchPlan>,
}

const runPlannerPipeline = async (
    question: string,
    depth: string,
    scope: string,
    deps: PlannerPipelineDeps,
    signal?: AbortSignal,
) => {
    let count = 0;

    if (signal?.aborted) {
        throw new Error("Run stopped")
    }

    let plan = await deps.initialPlan(question, depth, scope, signal);
    const review = await deps.reviewPlan(question, plan, signal);

    while (!review.valid && count < 2) {
        plan = await deps.revisePlan(question, depth, scope, plan, review, signal);
        count++;
    }

    return plan;
}

export const createResearchPlan = async (
    question: string,
    depth: string,
    scope: string,
    signal?: AbortSignal,
  ) => {
  
    return await runPlannerPipeline(
      question,
      depth,
      scope,
      {
        initialPlan: createInitialPlan,
        reviewPlan: reviewPlan,
        revisePlan: revisePlan,
      },
      signal,
    )
  }
  