import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport, verifyFindings } from "../report.service.js";
import { client } from "../../config/openRouterAI.js";
import { readableEvidence } from "../../../../shared/readableEvidence.js";
import type { Source } from "../../types/research.js";
import type { Analysis } from "../../zodSchema/research.schema.js";

const source: Source = {
  id: "S123456789abc",
  title: "Queue documentation",
  url: "https://example.com/queue",
  highlights: [
    "Workers use Redis to store queue state and support retry backoff.",
  ],
  queries: ["queue"],
  retrievedAt: "2026-09-27T00:00:00Z",
};
const analysis: Analysis = {
  findings: [
    "Workers store queue state in Redis.",
    "Workers support retry backoff.",
  ].map((claim) => ({
    claim,
    evidence: [{ sourceId: source.id, quote: source.highlights[0] }],
  })),
  gaps: ["Maximum retry counts were not specified."],
  followUpQueries: [],
};

test("report opens with a direct paragraph and retains detailed bullets before limitations and sources", () => {
  const report = renderReport("How do queues work?", analysis, [source], {
    overview: [0],
    sections: [{ heading: "Storage and retries", findingIndexes: [0, 1] }],
  });
  const blocks = report.split("\n\n");
  assert.equal(blocks[0], "# Question: How do queues work?");
  assert.match(blocks[1], /^Workers store queue state/);
  assert.doesNotMatch(blocks[1], /^- /);
  assert.equal(blocks[2], "## Storage and retries");
  assert.equal(blocks[3].split("\n").length, 2);
  assert.match(blocks[3], /- Workers store queue state/);
  assert.ok(report.indexOf("## Limitations") < report.indexOf("## Sources"));
  assert.match(report, /Maximum retry counts/);
  assert.ok(report.includes(source.url));
});

test("old layouts without an overview still get a direct answer", () => {
  const report = renderReport("How do queues work?", analysis, [source], {
    overview: [],
    sections: [{ heading: "Details", findingIndexes: [0, 1] }],
  });
  assert.match(report.split("\n\n")[1], /^Workers store queue state/);
});

test("verification batches preserve global finding indexes and reject out-of-range IDs", async (t) => {
  const findings = Array.from({ length: 9 }, (_, i) => ({
    ...analysis.findings[0],
    claim: `Finding ${i}`,
  }));
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    const input = JSON.parse(request.messages[1].content);
    assert.ok(input.findings.length <= 4);
    calls++;
    return {
      choices: [
        { message: { content: JSON.stringify({ supported: [0, 3, 99] }) } },
      ],
    };
  });
  const verified = await verifyFindings("How?", { ...analysis, findings }, [
    source,
  ]);
  assert.equal(calls, 3);
  assert.deepEqual(
    verified.findings.map((f) => f.claim),
    ["Finding 0", "Finding 3", "Finding 4", "Finding 7", "Finding 8"],
  );
});

test("evidence display removes extraction syntax without losing readable facts", () => {
  const raw =
    "<|startoftext|>## **Revenue**\\n<p>Sales &amp; growth were &#x32;0%.</p> [Read more](https://example.com) `2026`";
  assert.equal(
    readableEvidence(raw),
    "Revenue Sales & growth were 20%. Read more 2026",
  );
  assert.equal(
    readableEvidence(
      "<script>hidden()</script>**Retries**: 3 &mdash; 5 seconds",
    ),
    "Retries: 3 — 5 seconds",
  );
  assert.equal(
    readableEvidence("Latency: 2 < 3 ms; accuracy > 90%"),
    "Latency: 2 < 3 ms; accuracy > 90%",
  );
});

test("expanded extraction retains longer evidence and produces up to twelve grounded findings in bounded batches", async (t) => {
  const { analyzeEvidence } = await import("../evidence.service.js");
  const sources = Array.from({ length: 10 }, (_, index) => ({
    ...source,
    id: `source-${index}`,
    highlights: [
      "Evidence with useful details. ".repeat(40),
      "More evidence and qualifications. ".repeat(40),
    ],
  }));
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    const { excerpts } = JSON.parse(request.messages[1].content);
    assert.equal(excerpts.length, 10);
    assert.ok(excerpts[0].text.length > 450);
    // Allow room for the doubled completion allowance on a correction.
    assert.ok(
      Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 3) +
        request.max_tokens * 2 <
        8000,
    );
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              findings: Array.from({ length: 6 }, (_, index) => ({
                claim: `Batch ${calls}, finding ${index}.`,
                excerptIds: [excerpts[index].excerptId],
              })),
              gaps: [],
            }),
          },
        },
      ],
    };
  });
  const result = await analyzeEvidence("What does the evidence show?", sources);
  assert.equal(calls, 2);
  assert.equal(result.findings.length, 12);
  assert.ok(
    result.findings.every((f) =>
      sources.some(
        (s) =>
          s.id === f.evidence[0].sourceId &&
          s.highlights.some((h) => h.includes(f.evidence[0].quote)),
      ),
    ),
  );
});
