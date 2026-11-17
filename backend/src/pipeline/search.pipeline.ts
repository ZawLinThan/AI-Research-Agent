import { reviewSearch, search } from "../services/search.service.js";
import type { Source } from "../types/research.js";
import type { ResearchPlan } from "../zodSchema/research.schema.js";

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

  let next = 0;
  let saving = Promise.resolve();
  const originalCheckpoint = checkpoint;

  checkpoint = () => {
    saving = saving.then(originalCheckpoint);

    return saving;
  };

  await Promise.all(
    Array.from({ length: Math.min(3, plan.queries.length) }, async () => {
      while (next < plan.queries.length) {
        await execute(plan.queries[next++]);
      }
    }),
  );

  return searches;
};
