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

test("approved searches are checkpointed and automatic follow-ups are not dispatched", async () => {
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
  await run();
  assert.equal(checkpoints, 1);
  await run();
  assert.deepEqual(calls, ["initial"]);
  assert.equal(reviews, 0);
  assert.equal(checkpoints, 1);
});

test("verbose planner feedback succeeds in one model call without changing the verdict", async (t) => {
  const { client } = await import("../../config/openRouterAI.js");
  const { reviewPlan } = await import("../planner.service.js");
  const feedback = [
    " First issue ",
    "First issue",
    "Second issue",
    "Third issue",
    "Fourth issue",
  ];
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return {
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              ...review,
              issues: feedback,
              missingAngles: feedback,
              revisionInstructions: [
                "Important revision. ".repeat(30),
                ...feedback,
              ],
            }),
          },
        },
      ],
    };
  });
  const result = await reviewPlan("Compare the research methods", {
    queries: ["research methods"],
  });
  assert.equal(calls, 1);
  assert.equal(result.valid, false);
  assert.deepEqual(result.score, review.score);
  assert.deepEqual(result.issues, [
    "First issue",
    "Second issue",
    "Third issue",
  ]);
  assert.deepEqual(result.missingAngles, result.issues);
  assert.equal(result.revisionInstructions.length, 3);
  assert.ok(result.revisionInstructions.every((item) => item.length <= 200));
});

test("planner feedback normalization retains malformed entries and invalid decision fields for rejection", async () => {
  const { normalizePlanReview } =
    await import("../../lib/modelOutputNormalization.js");
  const { planReviewSchema } =
    await import("../../zodSchema/research.schema.js");
  for (const patch of [
    { issues: ["one", "two", "three", { text: "invalid fourth entry" }] },
    { missingAngles: "wrong type" },
    { revisionInstructions: null },
    { valid: "true" },
    { score: { ...review.score, coverage: 2 } },
  ]) {
    assert.equal(
      planReviewSchema.safeParse(normalizePlanReview({ ...review, ...patch }))
        .success,
      false,
    );
  }
});

test("invalid plans stop after exactly one revision", async () => {
  let revisions = 0,
    reviews = 0;
  await assert.rejects(
    createResearchPlan("Question", "Deep research", "Web", undefined, {
      initial: async () => ({ queries: ["initial"] }),
      revise: async () => {
        revisions++;
        return { queries: ["revised"] };
      },
      review: async () => {
        reviews++;
        return review;
      },
    }),
    /failed review after one revision/,
  );
  assert.equal(revisions, 1);
  assert.equal(reviews, 2);
});
test("deterministic checks reject future years, empty queries and missing entities", async () => {
  const { planIssues } = await import("../planner.service.js");
  const issues = planIssues(
    {
      queries: ["", "JPMorgan Chase 2027 revenue"],
      brief: {
        originalQuestion: "JPM vs BAC",
        intent: "Compare banks",
        domain: "banking",
        answerShape: "comparison",
        entities: ["JPMorgan Chase", "Bank of America"],
        currentDate: "2026-10-09",
      },
    },
    "Deep research",
  );
  assert.equal(issues.length, 4);
});

test("searches use bounded parallelism and retain checkpointed queries", async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const searches: Record<string, Source[]> = { existing: [] };
  await searchForSources(
    searches,
    "Question",
    { queries: ["existing", "one", "two", "three", "four"] },
    "Web",
    new AbortController().signal,
    async () => {},
    {
      search: async () => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return [];
      },
      review: async () => {
        throw new Error("Unused");
      },
    },
  );
  assert.equal(calls, 4);
  assert.equal(peak, 3);
  assert.equal(Object.keys(searches).length, 5);
});

test("ticker entities accept full company names without false missing-entity flags", async () => {
  const { planIssues } = await import("../planner.service.js");
  assert.deepEqual(
    planIssues(
      {
        queries: [
          "JPMorgan Chase Bank of America Wells Fargo latest available earnings",
        ],
        brief: {
          originalQuestion: "jpm vs bac vs wfc",
          intent: "comparison",
          domain: "financial",
          answerShape: "comparison",
          entities: ["JPM", "BAC", "WFC"],
          currentDate: "2026-10-09",
        },
      },
      "Deep research",
    ),
    [],
  );
  assert.equal(
    planIssues(
      {
        queries: ["JPMorgan Chase revenue"],
        brief: {
          originalQuestion: "jpm vs bac vs wfc",
          intent: "comparison",
          domain: "financial",
          answerShape: "comparison",
          entities: ["JPM", "BAC", "WFC"],
          currentDate: "2026-10-09",
        },
      },
      "Deep research",
    ).length,
    2,
  );
});
test("planner and reviewer receive explicit calendar context and alias equivalence", async (t) => {
  const { client } = await import("../../config/openRouterAI.js");
  const { reviewPlan, dateContext } = await import("../planner.service.js");
  assert.match(
    dateContext("2026-10-09"),
    /previous completed calendar year is 2025/,
  );
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    assert.match(request.messages[0].content, /Today is 2026-10-09/);
    assert.match(
      request.messages[0].content,
      /ticker aliases refer to the same entity/,
    );
    return {
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ ...review, valid: true }) },
        },
      ],
    };
  });
  await reviewPlan("JPM vs BAC vs WFC", {
    queries: ["latest earnings"],
    brief: {
      originalQuestion: "JPM vs BAC vs WFC",
      intent: "comparison",
      domain: "financial",
      answerShape: "comparison",
      entities: ["JPM", "BAC", "WFC"],
      currentDate: "2026-10-09",
    },
  });
});

test("broad requests discover released quarterly periods rather than assuming Q3 is available", async () => {
  const { normalizeQueryPeriod } = await import("../planner.service.js");
  const brief = {
    originalQuestion: "JPM vs BAC vs WFC",
    intent: "comparison",
    domain: "financial",
    answerShape: "comparison" as const,
    entities: ["JPM"],
    currentDate: "2026-10-09",
  };
  const query = {
    id: "Q1",
    query: "JPM Q3 2026 revenue",
    entities: ["JPM"],
    informationNeed: "Latest performance",
    targetPeriod: "Q3 2026",
  };
  const result = normalizeQueryPeriod(query, brief);
  assert.equal(result.query, "JPM latest released quarterly revenue");
  assert.equal(result.targetPeriod, "Latest released quarter as of 2026-10-09");
  assert.deepEqual(
    normalizeQueryPeriod(query, {
      ...brief,
      originalQuestion: "When will JPM report Q3 2026?",
    }),
    query,
  );
});

const comparisonBrief = {
  originalQuestion: "JPM vs BAC vs WFC",
  intent: "comparison",
  domain: "financial",
  answerShape: "comparison" as const,
  entities: ["JPM", "BAC", "WFC"],
  currentDate: "2026-10-09",
};
test("comparison queries are constructed with all entities and one metric", async () => {
  const { buildComparisonQuery, planIssues } =
    await import("../planner.service.js");
  const queries = ["net interest income", "diluted EPS"].map((metric, i) =>
    buildComparisonQuery(
      {
        id: `Q${i + 1}`,
        query: "JPM revenue and EPS",
        entities: ["JPM"],
        informationNeed: metric,
        targetPeriod: "2025",
        metric,
      },
      comparisonBrief,
    ),
  );
  assert.deepEqual(
    queries.map((q) => q.query),
    [
      "JPMorgan Chase Bank of America Wells Fargo 2025 net interest income",
      "JPMorgan Chase Bank of America Wells Fargo 2025 diluted EPS",
    ],
  );
  assert.ok(queries.every((q) => q.entities.length === 3));
  assert.deepEqual(
    planIssues(
      {
        brief: comparisonBrief,
        queries: queries.map((q) => q.query),
        plannedQueries: queries,
      },
      "Deep research",
    ),
    [],
  );
});
test("entity coverage is required per comparison query, not just across the plan", async () => {
  const { planIssues } = await import("../planner.service.js");
  const queries = [
    "JPM 2025 diluted EPS",
    "BAC 2025 diluted EPS",
    "WFC 2025 diluted EPS",
  ];
  assert.equal(
    planIssues({ brief: comparisonBrief, queries }, "Deep research").length,
    3,
  );
  assert.deepEqual(
    planIssues(
      { brief: { ...comparisonBrief, answerShape: "overview" }, queries },
      "Deep research",
    ),
    [],
  );
});
test("comparison queries reject closely related metric bundles", async () => {
  const { planIssues } = await import("../planner.service.js");
  for (const metric of [
    "revenue and net income",
    "net interest income diluted EPS",
    "total assets net interest margin",
    "market cap stock price",
  ]) {
    const issues = planIssues(
      { brief: comparisonBrief, queries: [`JPM BAC WFC 2025 ${metric}`] },
      "Deep research",
    );
    assert.equal(issues.length, 1, metric);
    assert.match(issues[0], /exactly one metric/);
  }
});
test("comparison generation requires a metric and preserves non-comparison plans", async () => {
  const { buildComparisonQuery } = await import("../planner.service.js");
  const query = {
    id: "Q1",
    query: "Leading technology companies",
    entities: [],
    informationNeed: "Industry overview",
  };
  assert.throws(
    () => buildComparisonQuery(query, comparisonBrief),
    /one metric/,
  );
  assert.deepEqual(
    buildComparisonQuery(query, {
      ...comparisonBrief,
      answerShape: "overview",
    }),
    query,
  );
});
