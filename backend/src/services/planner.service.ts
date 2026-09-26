import { structured } from "../config/groqAI.js";
import {
  ResearchPlan,
  planSchema,
  PlanReview,
  planReviewSchema,
} from "../zodSchema/research.schema.js";

export const createInitialPlan = async (
  question: string,
  depth: string,
  scope: string,
  signal?: AbortSignal,
): Promise<ResearchPlan> => {
  const currentDate = new Date().toISOString().split("T")[0];
  console.log("Creating initial research plan");

  return structured(
    `
      You are a general-purpose research planning agent.
  
      Current date: ${currentDate}
  
      Your job is to understand the user's request and create a high-quality web research plan.
  
      First infer:
      - the user's research goal
      - the topic/domain
      - the relevant entity types
      - the main dimensions needed to answer the question
  
      Then generate diverse, up-to-date search queries using today date. The current date is provided. 
  
      Rules:
      1. Preserve the user's original meaning.
      2. Do not arbitrarily narrow broad terms.
      3. Infer entity types from the domain.
      4. When the user asks for "leading", "top", or "best", identify the real-world entities that are most relevant to that domain.
      5. Search queries should cover different dimensions and avoid redundancy.
      6. Use up-to-date information when the question is time-sensitive. Current date is given.
      7. Do not assume all organizations are universities, companies, nonprofits, or research institutes. Infer the appropriate types from context.
      8. Include named entities in queries only when they are likely relevant, but do not hardcode domain-specific companies.
      9. Prefer broad discovery queries first, then narrower comparison or evidence queries.
      10. Return {"queries":["specific search query"]}. 
      11. Use 3 queries for Quick overview, 6 for Deep research. 
      12. Cover distinct aspects. 
      13. Respect the requested source scope. Do not answer the question.
      `,
    { question, depth, scope },
    planSchema,
    signal,
    1400,
  );
};

export const reviewPlan = async (
  question: string,
  plan: ResearchPlan,
  signal?: AbortSignal,
): Promise<PlanReview> => {
  const currentDate = new Date().toISOString().split("T")[0];

  console.log("Reviewing research plan");

  return structured(
    `
    You are reviewing a research plan before web search.

    Current date: ${currentDate}

    Do NOT answer the user's research question.

    Evaluate whether the proposed search plan will retrieve enough
    high-quality evidence to answer the user's original request.

    Evaluate whether all queries in the plan will answer the user's question 
    straightforwardly or not. If any query doesn't directly answer the question 
    or hitting from the wrong angle, mark 'valid' to false, and add this in the issues
    and revisionInstructions.

    Check:

    1. Intent alignment
    - Does the plan preserve the user's meaning?
    - Has it introduced assumptions the user didn't make?

    2. Coverage
    - Are important aspects of the question missing?

    3. Query diversity
    - Are queries investigating genuinely different angles?
    - Flag semantically redundant queries.

    4. Search quality
    - Are queries specific enough for a web search engine?
    - Are they overly narrow?

    5. Freshness
    - For time-sensitive topics, does the plan target current information?
    - Do not require a year when it would unnecessarily restrict results.

    Return a structured review.
    `,
    {
      question,
      plan,
    },
    planReviewSchema,
    signal,
    1400,
  );
};

export const revisePlan = async (
  question: string,
  depth: string,
  scope: string,
  originalPlan: ResearchPlan,
  review: PlanReview,
  signal?: AbortSignal,
): Promise<ResearchPlan> => {
  const currentDate = new Date().toISOString().split("T")[0];
  console.log("Revising research plan based on review feedback");

  return structured(
    `
    You are revising a web research plan.

    Current date: ${currentDate}

    Your job is to improve the original research plan using the review feedback.

    Do NOT answer the user's question.
    Return only a corrected research plan.

    Revision rules:
    1. Preserve the user's original intent.
    2. Fix every issue identified in the review when reasonable.
    3. Add missing research angles identified by the review.
    4. Remove or rewrite redundant queries.
    5. Keep queries useful for a web search engine.
    6. Do not make queries unnecessarily narrow.
    7. For time-sensitive topics, prefer current information.
    8. Do not add a year unless it improves search quality.
    9. Do not introduce assumptions that are not supported by the user's question.
    10. Each query should investigate a distinct aspect of the question.
    11. Return the same research-plan structure as the original planner.
    12. Respect the requested research depth.
    13. Respect the requested source scope.
    14. Use 3 queries for quick research and 6 queries for deep research.
    `,
    {
      question,
      depth,
      scope,
      originalPlan,
      review,
    },
    planSchema,
    signal,
    1400,
  );
};
