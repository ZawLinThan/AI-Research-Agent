import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../../config/openRouterAI.js";
import {
  extractEvidenceRecords,
  synthesizeEvidence,
} from "../evidenceReport.service.js";
import type { Checkpoint, Source } from "../../types/research.js";
const source: Source = {
  id: "S1",
  url: "https://example.com/results",
  title: "Q2 results",
  queries: ["results"],
  highlights: ["Bank A reported revenue of $10 billion in Q2 2026."],
  retrievedAt: "2026-10-09",
};
const response = (value: unknown) => ({
  choices: [
    { finish_reason: "stop", message: { content: JSON.stringify(value) } },
  ],
});
test("evidence extraction preserves exact quotes and metadata, rejects invented quotes and resumes", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      evidence: [
        {
          claim: "Bank A revenue was $10 billion.",
          entity: "Bank A",
          metric: "revenue",
          value: "$10 billion",
          period: "Q2 2026",
          quote: source.highlights[0],
        },
        {
          claim: "Bank A reported Q3 results.",
          quote: "Bank A reported Q3 results in October.",
        },
      ],
    });
  });
  const state: Checkpoint = {};
  const signal = new AbortController().signal;
  const records = await extractEvidenceRecords(
    "Bank results",
    [source],
    state,
    signal,
    async () => {},
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].period, "Q2 2026");
  assert.equal(records[0].quote, source.highlights[0]);
  await extractEvidenceRecords(
    "Bank results",
    [source],
    state,
    signal,
    async () => {},
  );
  assert.equal(calls, 1);
  t.mock.method(client.chat.completions, "create", async () =>
    response({
      claims: [
        { text: "Supported revenue claim.", evidenceIds: [records[0].id] },
        { text: "Unknown citation.", evidenceIds: ["invented"] },
      ],
      gaps: [],
    }),
  );
  const analysis = await synthesizeEvidence(
    "Bank results",
    records,
    [source],
    state,
    signal,
  );
  assert.equal(analysis.findings.length, 1);
  assert.equal(analysis.findings[0].evidence[0].quote, source.highlights[0]);
  assert.deepEqual(state.reportClaims?.[0].evidenceIds, [records[0].id]);
});

test("oversized evidence arrays are grounded, deduplicated and capped in one call", async (t) => {
  const quote = source.highlights[0];
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      evidence: [
        {
          claim: "Invented evidence.",
          quote: "This passage does not occur in the supplied source.",
        },
        ...Array.from({ length: 12 }, (_, i) => ({
          claim: `Claim ${i}.`,
          quote,
        })),
      ],
    });
  });
  const state: Checkpoint = {};
  const result = await extractEvidenceRecords(
    "Bank results",
    [source],
    state,
    new AbortController().signal,
    async () => {},
  );
  assert.equal(calls, 1);
  assert.equal(result.length, 8);
  assert.ok(result.every((e) => e.quote === quote));
  assert.equal(result[0].claim, "Claim 0.");
  assert.deepEqual(state.extractedSourceIds, [source.id]);
});

test("provider-rejected oversized evidence can be normalized without another model call", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    throw Object.assign(new Error("JSON validation failed"), {
      code: "json_validate_failed",
      error: {
        failed_generation: JSON.stringify({
          evidence: Array.from({ length: 12 }, (_, i) => ({
            claim: `Claim ${i}.`,
            quote: source.highlights[0],
          })),
        }),
      },
    });
  });
  const result = await extractEvidenceRecords(
    "Bank results",
    [source],
    {},
    new AbortController().signal,
    async () => {},
  );
  assert.equal(calls, 1);
  assert.equal(result.length, 8);
});

test("normalization preserves malformed overflow and never truncates factual text", async () => {
  const { normalizeExtractedEvidence } =
    await import("../evidenceReport.service.js");
  const good = {
    claim: "Bank A reported revenue.",
    quote: source.highlights[0],
  };
  assert.deepEqual(
    normalizeExtractedEvidence({ evidence: [good, good] }, source.highlights),
    { evidence: [good] },
  );
  for (const bad of [
    null,
    { ...good, quote: "x".repeat(1201) },
    { ...good, claim: "x".repeat(801) },
  ]) {
    const value = { evidence: [...Array.from({ length: 8 }, () => good), bad] };
    assert.equal(normalizeExtractedEvidence(value, source.highlights), value);
  }
});

test("comparison extraction rejects cross-bank figures and undated records", async (t) => {
  const wells: Source = {
    ...source,
    id: "W",
    url: "https://www.wellsfargo.com/results",
    title: "Wells Fargo FY2025 results",
    highlights: ["Total revenue was $83.7 billion in 2025."],
  };
  const state: Checkpoint = {
    plan: {
      queries: ["JPM BAC WFC 2025 revenue"],
      brief: {
        originalQuestion: "JPM vs BAC vs WFC",
        intent: "comparison",
        answerShape: "comparison",
        domain: "financial",
        entities: ["JPM", "BAC", "WFC"],
        currentDate: "2026-10-09",
      },
    },
  };
  t.mock.method(client.chat.completions, "create", async () =>
    response({
      evidence: [
        {
          claim: "JPMorgan Chase revenue was $83.7 billion.",
          entity: "JPMorgan Chase",
          metric: "revenue",
          period: "2025",
          value: "$83.7 billion",
          quote: wells.highlights[0],
        },
        {
          claim: "Wells Fargo revenue was $83.7 billion.",
          entity: "Wells Fargo",
          metric: "revenue",
          period: "FY2025",
          value: "$83.7 billion",
          quote: wells.highlights[0],
        },
        {
          claim:
            "Wells Fargo revenue was $83.7 billion in the most recent period.",
          entity: "Wells Fargo",
          metric: "revenue",
          period: "most recent period",
          quote: wells.highlights[0],
        },
      ],
    }),
  );
  const result = await extractEvidenceRecords(
    "JPM vs BAC vs WFC",
    [wells],
    state,
    new AbortController().signal,
    async () => {},
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].entity, "Wells Fargo");
  assert.equal(state.evidenceRejections?.length, 2);
});

test("comparison grouping aligns entities, periods and reported bases", async () => {
  const { evidenceGroups, periodKey, sourceOwner } =
    await import("../../lib/evidenceIdentity.js");
  assert.equal(periodKey("4Q25"), "Q4 2025");
  assert.equal(periodKey("Q4 2025"), "Q4 2025");
  const base = {
    id: "E1",
    claim: "Revenue fact.",
    metric: "total revenue",
    period: "FY2025",
    value: "$83.7 billion",
    sourceUrl: source.url,
    sourceTitle: source.title,
    quote: source.highlights[0],
  };
  const records = [
    { ...base, entity: "Wells Fargo", basis: "GAAP" },
    {
      ...base,
      id: "E2",
      entity: "WFC",
      metric: "revenue",
      period: "2025",
      basis: "full year",
    },
    {
      ...base,
      id: "E3",
      entity: "JPMorgan Chase & Co.",
      value: "$182 billion",
      basis: "consolidated statements of income",
    },
    { ...base, id: "E4", entity: "BAC", period: "Q4 2025" },
  ];
  const groups = [...evidenceGroups(records).values()];
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
  assert.equal(groups[1].length, 1);
  assert.equal(
    sourceOwner(
      "https://www.sec.gov/Archives/edgar/data/70858/000007085826000020/bac12312025ex991.htm",
      "bac12312025ex991",
    ),
    "Bank of America",
  );
});

test("coverage is calculated globally instead of repeating batch-local missing evidence", async () => {
  const { comparisonCoverageGaps } =
    await import("../evidenceReport.service.js");
  const state: Checkpoint = {
    plan: {
      queries: ["JPM BAC WFC 2025 diluted EPS"],
      plannedQueries: [
        {
          id: "Q1",
          query: "JPM BAC WFC 2025 diluted EPS",
          metric: "diluted EPS",
          entities: ["JPM", "BAC", "WFC"],
          informationNeed: "EPS",
        },
      ],
      brief: {
        originalQuestion: "JPM vs BAC vs WFC",
        intent: "comparison",
        answerShape: "comparison",
        domain: "financial",
        entities: ["JPM", "BAC", "WFC"],
        currentDate: "2026-10-09",
      },
    },
  };
  const records = ["JPMorgan Chase", "Bank of America", "Wells Fargo"].map(
    (entity, i) => ({
      id: `E${i}`,
      entity,
      metric: "diluted earnings per share",
      period: "2025",
      value: "$6",
      claim: "EPS fact.",
      quote: source.highlights[0],
      sourceUrl: source.url,
      sourceTitle: source.title,
    }),
  );
  assert.deepEqual(comparisonCoverageGaps(records, state), []);
  const mismatched = records.map((e, i) => ({
    ...e,
    period: i === 2 ? "Q4 2025" : "2025",
  }));
  assert.match(
    comparisonCoverageGaps(mismatched, state)[0],
    /no shared reporting period/,
  );
  assert.doesNotMatch(
    comparisonCoverageGaps(mismatched, state)[0],
    /no attributable evidence/,
  );
});

test("comparison synthesis sees all peers together and ignores invented local coverage gaps", async (t) => {
  const entities = ["JPMorgan Chase", "Bank of America", "Wells Fargo"];
  const domains = ["jpmorganchase.com", "bankofamerica.com", "wellsfargo.com"];
  const sources = entities.map((entity, i) => ({
    ...source,
    id: `S${i}`,
    title: `${entity} FY2025 results`,
    url: `https://${domains[i]}/results`,
    highlights: [`${entity} revenue was $10 billion in FY2025.`],
  }));
  const records = sources.map((s, i) => ({
    id: `E${i}`,
    sourceUrl: s.url,
    sourceTitle: s.title,
    quote: s.highlights[0],
    claim: s.highlights[0],
    entity: entities[i],
    metric: "revenue",
    period: "FY2025",
    value: "$10 billion",
  }));
  const state: Checkpoint = {
    plan: {
      queries: ["JPM BAC WFC 2025 revenue"],
      plannedQueries: [
        {
          id: "Q1",
          query: "JPM BAC WFC 2025 revenue",
          metric: "revenue",
          entities,
          informationNeed: "Revenue",
        },
      ],
      brief: {
        originalQuestion: "JPM vs BAC vs WFC",
        intent: "comparison",
        answerShape: "comparison",
        domain: "financial",
        entities,
        currentDate: "2026-10-09",
      },
    },
  };
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    const input = JSON.parse(request.messages[1].content);
    assert.deepEqual(
      input.evidence.map((e: any) => e.entity),
      entities,
    );
    return response({
      claims: [
        {
          text: "The three banks each reported $10 billion of FY2025 revenue.",
          evidenceIds: ["E0", "E1", "E2"],
        },
        {
          text: "Duplicate comparison in other words.",
          evidenceIds: ["E1", "E2", "E0"],
        },
      ],
      // Comparison gaps are calculated from all retained evidence, so malformed
      // model-authored local gaps must not fail or override global coverage.
      gaps: [{ description: "No Wells Fargo revenue was found." }],
    });
  });
  const result = await synthesizeEvidence(
    "JPM vs BAC vs WFC",
    records,
    sources,
    state,
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.gaps, []);
});

test("reported growth percentages must agree with their current and prior figures", async () => {
  const { growthConsistencyIssue } =
    await import("../../lib/evidenceIdentity.js");
  assert.ok(
    growthConsistencyIssue(
      "Bank of America 4Q25 net income was $7.6 billion, up 18% YoY from $6.8 billion.",
    ),
  );
  assert.equal(
    growthConsistencyIssue(
      "Bank income was $7.6 billion, up 12% YoY from $6.8 billion.",
    ),
    undefined,
  );
  assert.equal(
    growthConsistencyIssue(
      "Bank income was $30.5 billion, up 19% YoY from $27.0 billion.",
    ),
    "Stated growth rate does not match the quoted current and prior values.",
  );
});

test("quarter spelling and annual comparisons do not create false period gaps", async () => {
  const { periodKey } = await import("../../lib/evidenceIdentity.js");
  for (const period of [
    "Q4 2025",
    "4Q25",
    "fourth quarter 2025",
    "fourth-quarter 2025",
    "4th quarter of 2025",
  ]) {
    assert.equal(periodKey(period), "Q4 2025");
  }
  assert.equal(periodKey("2025 vs 2024"), "FY 2025");
  assert.equal(periodKey("FY2025 compared to FY2024"), "FY 2025");
  assert.equal(periodKey("2024 vs 2025"), "FY 2024");
});
