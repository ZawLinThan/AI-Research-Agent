import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../../config/openRouterAI.js";
import {
  comparisonRows,
  createComparisonReportLayout,
} from "../comparisonReport.service.js";
import { renderReport } from "../report.service.js";
import type { Checkpoint, Source } from "../../types/research.js";
import type { Analysis } from "../../zodSchema/research.schema.js";
const entities = ["JPMorgan Chase", "Bank of America", "Wells Fargo"];
function fixture() {
  const sources: Source[] = entities.map((entity, i) => ({
    id: `S${String(i).repeat(12)}`,
    url: `https://example.com/${i}`,
    title: `${entity} results`,
    highlights: [
      `${entity} Q4 2025 net interest income was $${i + 10} billion.`,
    ],
    queries: [],
    retrievedAt: "2026-10-09",
  }));
  const analysis: Analysis = {
    findings: sources.map((s, i) => ({
      claim: s.highlights[0],
      evidence: [{ sourceId: s.id, quote: s.highlights[0] }],
    })),
    gaps: ["No shared period exists."],
    followUpQueries: [],
  };
  const state: Checkpoint = {
    plan: {
      queries: ["JPM BAC WFC NII"],
      plannedQueries: [
        {
          id: "Q1",
          query: "JPM BAC WFC NII",
          entities,
          informationNeed: "NII",
          metric: "net interest income",
        },
        {
          id: "Q2",
          query: "JPM BAC WFC EPS",
          entities,
          informationNeed: "EPS",
          metric: "diluted EPS",
        },
      ],
      brief: {
        entities,
        originalQuestion: "JPM vs BAC vs WFC",
        intent: "comparison",
        domain: "financial",
        answerShape: "comparison",
        currentDate: "2026-10-09",
      },
    },
    reportClaims: analysis.findings.map((f, i) => ({
      text: f.claim,
      evidenceIds: [`E${i}`],
    })),
    evidenceRecords: analysis.findings.map((f, i) => ({
      id: `E${i}`,
      claim: f.claim,
      quote: f.evidence[0].quote,
      entity: entities[i],
      metric: "net interest income",
      period: ["Q4 2025", "4Q25", "fourth quarter 2025"][i],
      value: `$${i + 10} billion`,
      basis: "Consolidated GAAP",
      sourceUrl: sources[i].url,
      sourceTitle: sources[i].title,
    })),
  };
  return { state, analysis, sources };
}
const response = (value: unknown) => ({
  choices: [
    { finish_reason: "stop", message: { content: JSON.stringify(value) } },
  ],
});
test("comparison matrix aligns quarters and reserves every requested entity and metric", () => {
  const { state, analysis } = fixture();
  const matrix = comparisonRows(analysis, state);
  assert.equal(matrix.rows.length, 2);
  assert.equal(matrix.rows[0].period, "Q4 2025");
  assert.deepEqual(
    matrix.rows[0].cells.map((cell) => cell.findingIndexes),
    [[0], [1], [2]],
  );
  assert.equal(matrix.rows[1].metric, "diluted eps");
  assert.deepEqual(matrix.rows[1].coveredEntities, []);
});
test("supported introduction does not fail merely because another metric is missing", async (t) => {
  const { state, analysis, sources } = fixture();
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () =>
    response(
      ++calls === 1
        ? {
            summary:
              "The three banks have supported Q4 2025 net interest income figures.",
            overview: [0, 1, 2],
          }
        : { valid: true, reason: "Supported and qualified." },
    ),
  );
  const layout = await createComparisonReportLayout(
    "JPM vs BAC vs WFC",
    analysis,
    state,
  );
  const report = renderReport("JPM vs BAC vs WFC", analysis, sources, layout);
  assert.equal(calls, 2);
  assert.match(
    report,
    /\| Metric \| Period \| Basis \| JPMorgan Chase \| Bank of America \| Wells Fargo \|/,
  );
  assert.match(report, /diluted eps \| Not established/);
  assert.doesNotMatch(
    report,
    /Partial answer|No shared period exists|broader synthesis could not/,
  );
  assert.match(report, /Other metric-period comparisons have gaps/);
  for (const source of sources) {
    assert.ok(report.includes(`[${source.id}]`));
  }
});
test("rejected introductions fall back to accurate coverage after exactly one repair", async (t) => {
  const { state, analysis, sources } = fixture();
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () =>
    response(
      ++calls % 2
        ? { summary: "JPMorgan is the best investment.", overview: [0] }
        : { valid: false, reason: "Unsupported recommendation." },
    ),
  );
  const layout = await createComparisonReportLayout(
    "JPM vs BAC vs WFC",
    analysis,
    state,
  );
  assert.equal(calls, 4);
  const report = renderReport("JPM vs BAC vs WFC", analysis, sources, layout);
  assert.match(report, /covers all requested entities/);
  assert.doesNotMatch(report, /best investment|Partial answer/);
  assert.equal(layout.reportVersion, 2);
});
test("compound metric claims cannot enter a single-metric comparison row", () => {
  const { state, analysis } = fixture();
  const original = analysis.findings[0].claim;
  analysis.findings[0].claim =
    "JPMorgan net income was $10 billion, or $2 per diluted share.";
  state.reportClaims![0].text = analysis.findings[0].claim;
  assert.equal(
    comparisonRows(analysis, state).rows[0].cells[0].findingIndexes.length,
    0,
  );
  analysis.findings[0].claim = original;
});
test("different bases remain separate and shared claims appear once", () => {
  const { state, analysis } = fixture();
  state.evidenceRecords![1].basis = "FTE";
  assert.equal(comparisonRows(analysis, state).rows.length, 3);
  state.evidenceRecords![1].basis = "Consolidated GAAP";
  analysis.findings = [
    {
      claim: "Each bank has a supported Q4 2025 net interest income figure.",
      evidence: analysis.findings.flatMap((f) => f.evidence),
    },
  ];
  state.reportClaims = [
    { text: analysis.findings[0].claim, evidenceIds: ["E0", "E1", "E2"] },
  ];
  const row = comparisonRows(analysis, state).rows[0];
  assert.deepEqual(row.sharedFindingIndexes, [0]);
  assert.ok(row.cells.every((cell) => cell.findingIndexes.length === 0));
});
test("equivalent reported basis labels share one comparison row", () => {
  const { state, analysis } = fixture();
  state.evidenceRecords![0].basis = "GAAP";
  state.evidenceRecords![1].basis = "Year ended December 31, 2025; in millions";
  state.evidenceRecords![2].basis =
    "Consolidated statements of income; quarterly trends";
  const matrix = comparisonRows(analysis, state);
  assert.equal(matrix.rows.length, 2);
  assert.equal(matrix.rows[0].basis, "reported consolidated");
  assert.deepEqual(
    matrix.rows[0].cells.map((cell) => cell.findingIndexes),
    [[0], [1], [2]],
  );
});
