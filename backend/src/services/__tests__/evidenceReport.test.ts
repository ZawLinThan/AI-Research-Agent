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
