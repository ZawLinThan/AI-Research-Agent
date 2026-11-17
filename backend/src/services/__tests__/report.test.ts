import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createReportLayout,
  renderReport,
  verifyFindings,
} from "../report.service.js";
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

test("verification keeps legal-entity provenance and removes false disagreements", async (t) => {
  const bankSource = {
    ...source,
    title: "Bank of America California capital",
    highlights: [
      "Bank of America California had $1.824 billion in Tier 1 capital.",
    ],
  };
  const evidence = [
    { sourceId: bankSource.id, quote: bankSource.highlights[0] },
  ];
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    const input = JSON.parse(request.messages[1].content);
    calls++;
    if (calls === 1) {
      assert.equal(input.findings[0].evidence[0].sourceTitle, bankSource.title);
      assert.equal(input.findings[0].evidence[0].sourceUrl, bankSource.url);
      assert.match(request.messages[0].content, /exact legal entity/);
      return { choices: [{ message: { content: '{"supported":[1,2]}' } }] };
    }
    assert.match(request.messages[0].content, /Different banks/);
    assert.deepEqual(input.disagreements[0].findingIndexes, [0, 1]);
    return { choices: [{ message: { content: '{"supported":[]}' } }] };
  });
  const verified = await verifyFindings(
    "Compare banks",
    {
      findings: [
        { claim: "Bank of America had $1.824 billion in capital.", evidence },
        { claim: "A supported finding.", evidence },
        { claim: "Another supported finding.", evidence },
      ],
      gaps: [],
      followUpQueries: [],
      disagreements: [{ topic: "Different entities", findingIndexes: [1, 2] }],
    },
    [bankSource],
  );
  assert.equal(verified.findings.length, 2);
  assert.deepEqual(verified.disagreements, []);
  assert.match(verified.gaps[0], /omitted/);
  assert.equal(calls, 2);
});

test("failed coverage produces a clearly incomplete report without a one-sided synthesis", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify(
            ++calls === 1
              ? {
                  summary: "One bank has capital.",
                  overview: [0],
                  sections: [],
                }
              : calls === 3
                ? { summary: "Another inadequate comparison.", overview: [0] }
                : { valid: false, reason: "Missing comparison entities." },
          ),
        },
      },
    ],
  }));
  const layout = await createReportLayout(
    "JPM vs BOFA vs Wells Fargo",
    analysis,
  );
  assert.equal(calls, 4);
  assert.equal(layout.summary, undefined);
  assert.equal(layout.summaryOmitted, true);
  const report = renderReport(
    "JPM vs BOFA vs Wells Fargo",
    analysis,
    [source],
    layout,
  );
  assert.match(report, /complete answer.*could not be validated/);
  assert.doesNotMatch(
    report,
    /One bank has capital|Another inadequate comparison/,
  );
});

test("long gap lists are consolidated for display while original evidence gaps remain intact", async (t) => {
  const gaps = Array.from({ length: 12 }, (_, i) => `Missing context ${i}`);
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify(
            ++calls === 1
              ? {
                  summary: "A supported synthesis.",
                  overview: [0],
                  sections: [],
                }
              : calls === 2
                ? { valid: true }
                : {
                    limitations: [
                      "Comparable reporting periods were unavailable.",
                    ],
                  },
          ),
        },
      },
    ],
  }));
  const input = { ...analysis, gaps };
  const layout = await createReportLayout("Question", input);
  assert.deepEqual(input.gaps, gaps);
  const report = renderReport("Question", input, [source], layout);
  assert.match(report, /Comparable reporting periods/);
  assert.doesNotMatch(report, /Missing context 11/);
  assert.equal(calls, 3);
});

test("merged topics are reorganized into broad-to-specific sections with all cited detail preserved", async (t) => {
  const findings = Array.from({ length: 8 }, (_, index) => ({
    claim: `Distinct supported detail ${index}.`,
    evidence: analysis.findings[0].evidence,
  }));
  const topics = findings.map((_, index) => ({
    heading: `Fragment ${index}`,
    findingIndexes: [index],
  }));
  const sections = [
    "Total assets and scale",
    "Net income profitability",
    "Revenue trends",
    "Market valuation",
  ].map((heading, index) => ({
    heading,
    findingIndexes: [index * 2, index * 2 + 1],
  }));
  const summary =
    "The banks differ in scale, earnings and valuation. Their revenue trends add context to those differences. The dated evidence supports a comparison across these dimensions.";
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    const input = JSON.parse(request.messages[1].content);
    if (++calls === 1) {
      assert.deepEqual(input.topics, topics);
      assert.match(request.messages[0].content, /3–5 sentences/);
      assert.match(request.messages[0].content, /2–4 substantive bullets/);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary,
                overview: [0, 2, 4, 6],
                sections,
              }),
            },
          },
        ],
      };
    }
    assert.deepEqual(input.sections, sections);
    return { choices: [{ message: { content: '{"valid":true}' } }] };
  });
  const input = { ...analysis, findings, topics };
  const layout = await createReportLayout("Compare banks", input);
  assert.deepEqual(layout.sections, sections);
  const report = renderReport("Compare banks", input, [source], layout);
  assert.ok(report.indexOf(summary) < report.indexOf("## Total assets"));
  assert.doesNotMatch(report, /## Fragment/);
  for (const finding of findings) {
    assert.equal(report.split(finding.claim).length - 1, 1);
    assert.ok(report.includes(`- ${finding.claim} [${source.id}]`));
  }
});

test("report opens with a direct paragraph and retains detailed bullets before limitations and sources", () => {
  const report = renderReport("How do queues work?", analysis, [source], {
    overview: [0],
    sections: [{ heading: "Storage and retries", findingIndexes: [0, 1] }],
  });
  const blocks = report.split("\n\n");
  assert.equal(blocks[0], "# Question: How do queues work?");
  assert.match(blocks[1], /^- Workers store queue state/);
  assert.match(blocks[1], /^- /);
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
  assert.match(report.split("\n\n")[1], /^- Workers store queue state/);
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

test("the introduction is independently paraphrased, cited, and saved without changing detail bullets", async (t) => {
  const summary =
    "Redis-backed queues coordinate work while allowing unsuccessful jobs to be attempted again after a delay.";
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    const input = JSON.parse(request.messages[1].content);
    assert.equal(input.findings.length, analysis.findings.length);
    if (calls === 1) {
      assert.match(
        request.messages[0].content,
        /Paraphrase.*ALL|ALL.*Paraphrase/,
      );
      assert.deepEqual(input.gaps, analysis.gaps);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary,
                overview: [0, 1, 999],
                sections: [
                  { heading: "Storage and retries", findingIndexes: [0, 1] },
                ],
              }),
            },
          },
        ],
      };
    }
    assert.equal(input.summary, summary);
    assert.deepEqual(input.summaryFindingIndexes, [0, 1]);
    return { choices: [{ message: { content: '{"valid":true}' } }] };
  });
  const layout = await createReportLayout("How do queues work?", analysis);
  const report = renderReport(
    "How do queues work?",
    analysis,
    [source],
    layout,
  );
  const introduction = report.split("\n\n")[1];
  assert.equal(layout.summary, summary);
  assert.equal(introduction, `- ${summary} [${source.id}]`);
  for (const finding of analysis.findings) {
    assert.ok(!introduction.includes(finding.claim));
    assert.ok(report.includes(`- ${finding.claim}`));
  }
  assert.equal(calls, 2);
});

test("unsupported summaries are revised once then omitted", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify(
            ++calls === 1
              ? {
                  summary: "Redis guarantees that all jobs succeed.",
                  overview: [0],
                  sections: [{ heading: "Details", findingIndexes: [0, 1] }],
                }
              : calls === 3
                ? { summary: "Redis guarantees success.", overview: [0] }
                : { valid: false },
          ),
        },
      },
    ],
  }));
  const layout = await createReportLayout("How do queues work?", analysis);
  assert.equal(calls, 4);
  assert.equal(layout.summaryOmitted, true);
  const report = renderReport(
    "How do queues work?",
    analysis,
    [source],
    layout,
  );
  assert.doesNotMatch(report, /Redis guarantees/);
  assert.ok(report.includes(analysis.findings[0].claim));
});

test("summary repair is reviewed against its revised evidence indexes", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    const input = JSON.parse(request.messages[1].content);
    const value =
      calls === 1
        ? {
            summary: "Unsupported opening.",
            overview: [0],
            sections: [{ heading: "Details", findingIndexes: [0, 1] }],
          }
        : calls === 2
          ? { valid: false, revisionInstructions: ["Use finding 1 only."] }
          : calls === 3
            ? { summary: "A repaired supported opening.", overview: [1] }
            : { valid: true };
    if (calls === 3) {
      assert.deepEqual(input.review.revisionInstructions, [
        "Use finding 1 only.",
      ]);
    }

    if (calls === 4) {
      assert.deepEqual(input.summaryFindingIndexes, [1]);
      assert.equal(input.summary, "A repaired supported opening.");
    }
    return { choices: [{ message: { content: JSON.stringify(value) } }] };
  });
  const layout = await createReportLayout("How do queues work?", analysis);
  assert.equal(calls, 4);
  assert.equal(layout.summary, "A repaired supported opening.");
  assert.deepEqual(layout.overview, [1]);
});
