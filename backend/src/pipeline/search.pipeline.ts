import { reviewSearch, search } from "../services/search.service.js";
import type { Source } from "../types/research.js";
import type { ResearchPlan } from "../zodSchema/research.schema.js";
import { SearchReview } from "../zodSchema/search.schema.js";

const calculateScore = (review: SearchReview) => {
  return (review.coverageScore+review.relevanceScore+review.sourceQualityScore)/3.0; 
}

export const searchForSources = async (
  searches: Record<string, Source[]>,
  question: string,
  plan: ResearchPlan,
  scope: string,
  signal: AbortSignal,
  checkpoint: () => Promise<void> = async () => {},
  deps = { search, review: reviewSearch },
): Promise<Record<string, Source[]>> => {
  const execute = async (query: string) => {
    signal.throwIfAborted();

    // if the query is already searched, ignore
    if (Object.hasOwn(searches, query)) {
      return;
    }

    console.log("Searching for query: ", query); 
    
    searches[query] = await deps.search(query, scope, signal);
    await checkpoint();
  };

  for (const query of plan.queries) {
    await execute(query);
  }
  
  console.log("Initial Search done")

  for (let round = 0; round <= 2; round++) {
    signal.throwIfAborted();
  
    const review = await deps.review(question, plan, searches, signal);
    console.log("Review round", round, review);
  
    if (review.sufficient || round === 2) break;
  
    const queries = [...new Set(review.followUpQueries)]
      .filter((q) => !Object.hasOwn(searches, q))
      .slice(0, 2);
  
    if (queries.length === 0) break;
  
    for (const query of queries) {
      await execute(query);
    }
  }
  return searches;
};
