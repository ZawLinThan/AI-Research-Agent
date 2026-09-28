import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEvidence } from "../evidence.service.js";
import { reviewSearch } from "../search.service.js";
import { client } from "../../config/openRouterAI.js";
import { ModelOutputError } from "../../lib/errors.js";
import { analysisSchema } from "../../zodSchema/research.schema.js";
import { normalizeEvidenceSelection } from "../../lib/modelOutputNormalization.js";

const sources = Array.from({ length: 3 }, (_, index) => ({
  id: `S${index}`,
  url: `https://example.com/${index}`,
  title: `Source ${index}`,
  highlights: [
    `Source ${index} reports comparable revenue data for the same year.`,
  ],
  queries: ["revenue"],
  retrievedAt: "2026-09-27T00:00:00Z",
}));

const response = (value: unknown) => ({
  choices: [
    { finish_reason: "stop", message: { content: JSON.stringify(value) } },
  ],
});

test("analysis normalizes excess excerpt IDs and text-only gap objects without another provider request", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      findings: [
        {
          claim: "Revenue data is available.",
          excerptIds: ["invented", "S0:0", "S0:0", "S1:0", "S2:0"],
        },
      ],
      gaps: [
        { gap: "Comparable costs are missing.", reason: "Definitions differ." },
        { description: "Future returns remain uncertain." },
      ],
    });
  });
  const result = await analyzeEvidence("Compare the companies", sources);
  assert.equal(calls, 1);
  assert.equal(result.findings[0].evidence.length, 2);
  assert.deepEqual(
    result.findings[0].evidence,
    sources
      .slice(0, 2)
      .map((s) => ({ sourceId: s.id, quote: s.highlights[0] })),
  );
  assert.deepEqual(result.gaps, [
    "Comparable costs are missing. Definitions differ.",
    "Future returns remain uncertain.",
  ]);
  assert.ok(analysisSchema.safeParse(result).success);
});

test("unrecognized gap objects still trigger correction and fail validation", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    if (calls === 2)
      assert.match(request.messages[0].content, /previous attempt was invalid/);
    return response({ findings: [], gaps: [{ arbitrary: 42 }] });
  });
  await assert.rejects(
    analyzeEvidence("Compare the companies", sources),
    (error) => {
      assert.ok(error instanceof ModelOutputError);
      assert.equal(error.correctionAttempted, true);
      assert.deepEqual(error.issues, [
        { path: "gaps.0", code: "invalid_type" },
      ]);
      return true;
    },
  );
  assert.equal(calls, 2);
});

test("normalization does not coerce bad IDs or fabricate missing fields", () => {
  const value = {
    findings: [{ excerptIds: [123, "S0:0"] }],
    gaps: [null, { description: "Context", evidence: { invented: true } }],
  };
  assert.deepEqual(normalizeEvidenceSelection(value, new Set(["S0:0"])), value);
});

test("invented excerpt IDs cannot become evidence after normalization", async (t) => {
  t.mock.method(client.chat.completions, "create", async () =>
    response({
      findings: [
        {
          claim: "Unsupported claim.",
          excerptIds: ["fake1", "fake2", "fake3"],
        },
      ],
      gaps: [],
    }),
  );
  const result = await analyzeEvidence("Compare the companies", sources);
  assert.deepEqual(result.findings, []);
});

test("search review deduplicates and limits follow-up queries without retrying", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      sufficient: false,
      relevanceScore: 0.5,
      coverageScore: 0.5,
      sourceQualityScore: 0.5,
      missingEvidence: [],
      weakAreas: [],
      reason: "Need comparable figures.",
      followUpQueries: [
        " company revenue ",
        "company revenue",
        "company costs",
        "company forecasts",
      ],
    });
  });
  const result = await reviewSearch(
    "Compare companies",
    { queries: ["revenue"] },
    {},
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.followUpQueries, [
    "company revenue",
    "company costs",
  ]);
});

test("search review accepts verbose explanations without a correction request", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      sufficient: false, relevanceScore: 0.5, coverageScore: 0.5,
      sourceQualityScore: 0.5,
      missingEvidence: Array.from({ length: 5 }, (_, i) => `${i}: ${"Missing comparable evidence. ".repeat(20)}`),
      weakAreas: ["Limited coverage. ".repeat(30)],
      reason: "More evidence is needed to resolve the disagreement. ".repeat(20),
      followUpQueries: ["comparable evidence"],
    });
  });
  const result = await reviewSearch("Compare companies", { queries: ["revenue"] }, {}, new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(result.missingEvidence.length, 3);
  assert.ok(result.missingEvidence.every((text) => text.length <= 200));
  assert.ok(result.weakAreas.every((text) => text.length <= 200));
  assert.ok(result.reason.length <= 400);
  assert.equal(result.sufficient, false);
});
