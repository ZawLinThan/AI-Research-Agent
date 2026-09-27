import { test } from "node:test";
import assert from "node:assert/strict";
import { createResearchPlan } from "../../pipeline/planner.pipeline.js";
import { searchForSources } from "../../pipeline/search.pipeline.js";
import type { PlanReview } from "../../zodSchema/research.schema.js";
import type { SearchReview } from "../../zodSchema/search.schema.js";
import type { Source } from "../../types/research.js";

const review: PlanReview = {
  valid: false,
  score: {
    intentAlignment: 1,
    coverage: 0,
    diversity: 1,
    searchability: 1,
    freshness: 1,
  },
  issues: [],
  missingAngles: [],
  revisionInstructions: [],
};
test("planner reviews the revised plan and stops when it becomes valid", async () => {
  const seen: string[] = [];
  const plan = await createResearchPlan(
    "Question",
    "Deep research",
    "Web",
    undefined,
    {
      initial: async () => ({ queries: ["initial"] }),
      review: async (_q, plan) => {
        seen.push(plan.queries[0]);
        return { ...review, valid: plan.queries[0] === "revised" };
      },
      revise: async () => ({ queries: ["revised"] }),
    },
  );
  assert.deepEqual(seen, ["initial", "revised"]);
  assert.deepEqual(plan.queries, ["revised"]);
});

test("search checkpoints survive a review failure and follow-up queries are bounded and deduplicated", async () => {
  const searches: Record<string, Source[]> = {};
  const calls: string[] = [];
  let checkpoints = 0,
    reviews = 0;
  const verdict: SearchReview = {
    sufficient: false,
    relevanceScore: 1,
    coverageScore: 0.5,
    sourceQualityScore: 1,
    missingEvidence: [],
    weakAreas: [],
    followUpQueries: ["initial", "follow up", "follow up"],
    reason: "Needs additional evidence",
  };
  const deps = {
    search: async (query: string) => {
      calls.push(query);
      return [];
    },
    review: async () => {
      reviews++;
      if (reviews === 1) throw new Error("review failed");
      return verdict;
    },
  };
  const run = () =>
    searchForSources(
      searches,
      "question",
      { queries: ["initial"] },
      "Web",
      new AbortController().signal,
      async () => {
        checkpoints++;
      },
      deps,
    );
  await assert.rejects(run(), /review failed/);
  assert.equal(checkpoints, 1);
  await run();
  assert.deepEqual(calls, ["initial", "follow up"]);
  assert.equal(checkpoints, 3);
});
