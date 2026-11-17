import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { client } from "../../config/openRouterAI.js";
import {
  selectSources,
  sourceId,
  groundedFindings,
} from "../evidence.service.js";
import {
  deduplicateSources,
  nearIdentical,
} from "../sourceDeduplication.service.js";
import {
  summarizeQuery,
  mergeQuerySummaries,
  analyzeQueryResults,
} from "../queryEvidence.service.js";
import {
  fetchSourceContext,
  contextPassages,
} from "../sourceContext.service.js";
import {
  verifyFindings,
  createReportLayout,
  renderReport,
} from "../report.service.js";
import { runPipeline, type RunRecord } from "../../pipeline/run.js";
import type { Source, Checkpoint } from "../../types/research.js";
import type { QuerySummary } from "../../zodSchema/queryEvidence.schema.js";

const signal = () => new AbortController().signal;
const response = (value: unknown) => ({
  choices: [
    { finish_reason: "stop", message: { content: JSON.stringify(value) } },
  ],
});
const source = (index: number, query = "query"): Source => ({
  id: sourceId(`https://example.com/article-${index}`),
  url: `https://example.com/article-${index}`,
  title: `Study ${index}`,
  highlights: [
    `Study ${index} reports detailed evidence about the research question, including its methods, measurements, and limitations.`,
  ],
  queries: [query],
  retrievedAt: "2026-09-27T00:00:00Z",
});
const emptySummary = (): QuerySummary => ({
  findings: [],
  disagreements: [],
  unansweredQuestions: [],
  needsContext: [],
});

test("URL deduplication canonicalizes tracking and query order without a ten-source cap", () => {
  const sources = Array.from({ length: 15 }, (_, i) => source(i));
  sources.push({
    ...source(0),
    url: source(0).url + "?utm_source=tracking",
    queries: ["follow up"],
  });
  const result = selectSources(sources);
  assert.equal(result.length, 15);
  assert.deepEqual(result.find((s) => s.id === source(0).id)?.queries, [
    "query",
    "follow up",
  ]);
});

test("near-copy and semantic deduplication retain different measurements and opposing evidence", async (t) => {
  const a = {
    ...source(0),
    highlights: [
      "The full report describes the study design and the participants in careful detail, covering the research methods and outcomes across the complete observation period.",
    ],
  };
  const copy = { ...source(1), highlights: [a.highlights[0].toUpperCase()] };
  const semantic = {
    ...source(2),
    highlights: [
      "This publication explains participant selection, study methodology, and observed outcomes over the entire research period.",
    ],
  };
  const conflicting = {
    ...source(3),
    highlights: [
      "The study does not support these outcomes. It found a decrease of 12 percent during the same observation period.",
    ],
  };
  assert.ok(nearIdentical(a, copy));
  assert.ok(!nearIdentical(a, conflicting));
  t.mock.method(client.chat.completions, "create", async () =>
    response({
      duplicates: [
        { sourceId: semantic.id, keepSourceId: a.id },
        { sourceId: conflicting.id, keepSourceId: a.id },
        { sourceId: "invented", keepSourceId: a.id },
      ],
    }),
  );
  const aliases = await deduplicateSources(
    [a, copy, semantic, conflicting],
    signal(),
  );
  assert.equal(aliases[copy.id], a.id);
  assert.equal(aliases[semantic.id], a.id);
  assert.equal(aliases[conflicting.id], undefined);
});

test("each summary considers all ten results and validates exact source quotes", async (t) => {
  const sources = Array.from({ length: 10 }, (_, i) => source(i));
  let invalid = false,
    calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    const input = JSON.parse(request.messages[1].content);
    assert.equal(input.sources.length, 10);
    return response({
      ...emptySummary(),
      findings: [
        {
          topic: "Methods",
          claim: "The study explains its methods.",
          evidence: [
            {
              sourceId: sources[0].id,
              quote: invalid
                ? "An invented quote that never appeared."
                : input.sources[0].excerpts[0],
            },
          ],
        },
      ],
    });
  });
  const summary = await summarizeQuery(
    "What are the findings?",
    "methods",
    sources,
    signal(),
  );
  assert.equal(summary.findings[0].evidence[0].quote, sources[0].highlights[0]);
  invalid = true;
  const unsupported = await summarizeQuery(
    "Question",
    "methods",
    sources,
    signal(),
  );
  assert.deepEqual(unsupported.findings, []);
  assert.match(
    unsupported.unansweredQuestions[0],
    /quotations could not be verified/,
  );
  assert.equal(calls, 2);
});

test("unverified claims are omitted entirely and disagreement indexes are remapped", async (t) => {
  const sources = [source(0), source(1)];
  const evidence = sources.map((s) => ({
    sourceId: s.id,
    quote: s.highlights[0],
  }));
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      ...emptySummary(),
      findings: [
        {
          topic: "Methods",
          claim: "Unsupported compound claim",
          evidence: [
            evidence[0],
            {
              ...evidence[1],
              quote: "This quotation was invented by the model.",
            },
          ],
        },
        {
          topic: "Methods",
          claim: "First verified finding",
          evidence: [evidence[0]],
        },
        {
          topic: "Methods",
          claim: "Second verified finding",
          evidence: [evidence[1]],
        },
        {
          topic: "Methods",
          claim: "Wrong source",
          evidence: [{ ...evidence[0], sourceId: "unknown" }],
        },
      ],
      disagreements: [
        { topic: "Retained conflict", findingIndexes: [1, 2] },
        { topic: "Removed conflict", findingIndexes: [0, 1] },
      ],
    });
  });
  const result = await summarizeQuery("Question", "methods", sources, signal());
  assert.equal(calls, 1);
  assert.deepEqual(
    result.findings.map((f) => f.claim),
    ["First verified finding", "Second verified finding"],
  );
  assert.deepEqual(result.disagreements, [
    { topic: "Retained conflict", findingIndexes: [0, 1] },
  ]);
  assert.match(result.unansweredQuestions[0], /omitted/);
});

test("incomplete disagreement references do not block evidence recovery", async (t) => {
  const s = source(0);
  let calls = 0;
  let unsupported = true;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      ...emptySummary(),
      findings: [
        {
          topic: "Methods",
          claim: "Verified finding",
          evidence: [{ sourceId: s.id, quote: s.highlights[0] }],
        },
        {
          topic: "Methods",
          claim: "Another finding",
          evidence: [
            {
              sourceId: s.id,
              quote: unsupported
                ? "This quotation was invented by the model."
                : s.highlights[0],
            },
          ],
        },
      ],
      disagreements: [
        { topic: "Incomplete", findingIndexes: [1] },
        { topic: "Empty", findingIndexes: [] },
        { topic: "Duplicate or out of range", findingIndexes: [0, 0, 8] },
      ],
    });
  });
  const recovered = await summarizeQuery("Question", "methods", [s], signal());
  assert.equal(recovered.findings.length, 1);
  assert.deepEqual(recovered.disagreements, []);
  assert.match(
    recovered.unansweredQuestions[0],
    /quotations could not be verified/,
  );
  unsupported = false;
  const grounded = await summarizeQuery("Question", "methods", [s], signal());
  assert.equal(grounded.findings.length, 2);
  assert.deepEqual(grounded.disagreements, []);
  assert.deepEqual(grounded.unansweredQuestions, []);
  assert.equal(calls, 2);
});

test("merging removes repeated claims, retains opposing evidence, and preserves source provenance", async (t) => {
  const a = source(0),
    b = source(1),
    c = source(2),
    d = source(3);
  const finding = (claim: string, s: Source) => ({
    topic: "Outcomes",
    claim,
    evidence: [{ sourceId: s.id, quote: s.highlights[0] }],
  });
  const summaries = {
    first: {
      ...emptySummary(),
      findings: [
        finding("The trial used random allocation.", a),
        finding("The intervention increased survival by 10%.", b),
      ],
    },
    second: {
      ...emptySummary(),
      findings: [
        finding("Participants were randomly assigned.", c),
        finding("The intervention decreased survival by 5%.", d),
      ],
    },
  };
  t.mock.method(client.chat.completions, "create", async () =>
    response({
      topics: [
        {
          heading: "Methods and outcomes",
          groups: [
            [0, 2],
            [1, 3],
          ],
        },
      ],
      disagreements: [
        { topic: "Survival results conflict", findingIndexes: [1, 3] },
      ],
    }),
  );
  const merged = await mergeQuerySummaries(summaries, signal());
  assert.equal(merged.findings.length, 3);
  assert.equal(merged.findings[0].evidence.length, 2);
  assert.deepEqual(merged.disagreements?.[0].findingIndexes, [1, 2]);
  assert.ok(merged.findings.some((f) => f.claim.includes("increased")));
  assert.ok(merged.findings.some((f) => f.claim.includes("decreased")));
  const report = renderReport("Question", merged, [a, b, c, d], {
    summary: "Results vary across studies.",
    overview: [1, 2],
    sections: merged.topics!,
  });
  assert.match(report, /Competing evidence/);
});

test("full-text context is fetched only when requested, checkpointed, and reused after a merge failure", async () => {
  const s = source(0);
  const state: Checkpoint = { sources: [s], searches: { query: [s] } };
  const quote =
    "The complete methodology shows that participants were randomly assigned to treatment groups.";
  let summaries = 0,
    fetches = 0,
    merges = 0,
    snapshots = 0;
  const deps = {
    deduplicate: async () => ({}),
    summarize: async (
      _question: string,
      _query: string,
      _sources: Source[],
      _signal: AbortSignal,
      contexts?: Record<string, string[]>,
    ) => {
      summaries++;
      if (!contexts) {
        return {
          ...emptySummary(),
          needsContext: [
            { sourceId: s.id, reason: "Need the full methodology." },
          ],
        };
      }

      assert.ok(contexts[s.id].some((text) => text.includes(quote)));
      return {
        ...emptySummary(),
        findings: [
          {
            topic: "Methodology",
            claim: "Participants were randomly assigned.",
            evidence: [{ sourceId: s.id, quote }],
          },
        ],
      };
    },
    fetchContext: async () => {
      fetches++;
      return quote;
    },
    merge: async (summaries: Record<string, QuerySummary>) => {
      if (++merges === 1) {
        throw new Error("temporary merge failure");
      }

      return {
        findings: summaries.query.findings,
        gaps: [],
        followUpQueries: [],
      };
    },
  };
  await assert.rejects(
    analyzeQueryResults(
      "Question",
      state,
      signal(),
      async () => {
        snapshots++;
      },
      deps,
    ),
    /temporary merge/,
  );
  const saved = structuredClone(state);
  assert.equal(saved.evidence?.documents?.[s.id], quote);
  assert.ok(saved.sources?.[0].highlights.includes(quote));
  const result = await analyzeQueryResults(
    "Question",
    saved,
    signal(),
    async () => {},
    deps,
  );
  assert.equal(fetches, 1);
  assert.equal(summaries, 2);
  assert.equal(groundedFindings(result, saved.sources!).findings.length, 1);
  assert.ok(snapshots >= 4);
});

test("full-source retrieval uses Exa contents and context windows remain verbatim", async (t) => {
  const s = source(0);
  t.mock.method(axios, "post", async (url: string, body: any, options: any) => {
    assert.equal(url, "https://api.exa.ai/contents");
    assert.deepEqual(body, { ids: [s.url], text: { maxCharacters: 50000 } });
    assert.ok(options.signal instanceof AbortSignal);
    return { data: { results: [{ url: s.url, text: "Full page body" }] } };
  });
  assert.equal(await fetchSourceContext(s, signal()), "Full page body");
  const document =
    "background ".repeat(1000) +
    "Randomisation allocation methodology: the study used randomly assigned cohorts.";
  const passages = contextPassages(
    document,
    "randomisation allocation methodology",
    "methods",
    3500,
  );
  assert.ok(
    passages.some((text) =>
      text.includes("Randomisation allocation methodology"),
    ),
  );
  assert.ok(passages.every((text) => document.includes(text)));
  assert.ok(passages.join("").length <= 3500);
});

test("six query summaries produce a verified report with more than ten cited sources", async (t) => {
  const queries = Array.from({ length: 6 }, (_, i) => `query ${i}`);
  const searches = Object.fromEntries(
    queries.map((query, i) => [
      query,
      Array.from({ length: 10 }, (_, j) => source(i * 10 + j, query)),
    ]),
  );
  const record: RunRecord = {
    id: "test",
    question: "What does the research show?",
    depth: "Deep research",
    scope: "Web",
    checkpoint: { planApproved: true },
    startedAt: new Date(),
  };
  let summaryCalls = 0,
    report = "";
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    const instruction = request.messages[0].content;
    const input = JSON.parse(request.messages[1].content);
    if (instruction.startsWith("Identify semantically")) {
      return response({ duplicates: [] });
    }

    if (instruction.startsWith("Analyze ALL")) {
      summaryCalls++;
      assert.equal(input.sources.length, 10);

      return response({
        ...emptySummary(),
        findings: input.sources.slice(0, 4).map((s: any, i: number) => ({
          topic: input.query,
          claim: `${input.query} finding ${i} covers the study methodology.`,
          evidence: [{ sourceId: s.sourceId, quote: s.excerpts[0] }],
        })),
      });
    }
    if (instruction.startsWith("Merge findings")) {
      return response({
        topics: queries.map((heading, i) => ({
          heading,
          groups: Array.from({ length: 4 }, (_, j) => [i * 4 + j]),
        })),
        disagreements: [],
      });
    }

    if (instruction.startsWith("Review claims")) {
      return response({
        supported: input.findings.map((_: unknown, i: number) => i),
      });
    }

    if (instruction.startsWith("Write a research report")) {
      return response({
        summary:
          "The studies provide complementary accounts of research methods across several topics.",
        overview: [0, 4, 8, 12, 16, 20],
        sections: input.topics,
      });
    }

    if (instruction.startsWith("Check this opening")) {
      return response({ valid: true });
    }

    if (instruction.startsWith("Summarize the verified evidence")) {
      return response({ summary: `Summary for ${input.query}.` });
    }

    if (instruction.startsWith("Answer the original question")) {
      return response({ summary: "Overall synthesis of the query summaries." });
    }

    throw new Error("Unexpected model request");
  });
  await runPipeline(
    record,
    {
      check: async () => {},
      save: async (state, _status, _progress, text) => {
        record.checkpoint = structuredClone(state);

        if (text) {
          report = text;
        }
      },
      plan: async () => ({ queries }),
      search: async () => searches,
      analyze: async () => {
        throw new Error("Legacy global analysis must not run");
      },
      analyzeQueries: analyzeQueryResults,
      verify: verifyFindings,
      present: createReportLayout,
    },
    signal(),
  );
  assert.match(report, /The studies provide complementary accounts/);
  for (const query of queries) {
    assert.ok(report.includes(`## ${query}`));
  }
  assert.equal(summaryCalls, 6);
  assert.equal(Object.keys(record.checkpoint.evidence!.summaries).length, 6);
  assert.equal(record.checkpoint.sources?.length, 60);
  assert.equal(record.checkpoint.verified?.findings.length, 24);
  assert.equal(record.checkpoint.verified?.topics?.length, 6);
  const citedIds = new Set(
    record.checkpoint.verified!.findings.flatMap((f) =>
      f.evidence.map((e) => e.sourceId),
    ),
  );
  assert.equal(citedIds.size, 24);
  for (const id of citedIds) {
    assert.ok(report.includes(`[${id}]`));
  }
});

test("a shared URL retains query-specific excerpts and does not misattribute duplicate URLs", async () => {
  const shared = source(0);
  const laterQuote =
    "The later query reveals additional methodological limitations not present in the first highlight.";
  const later = { ...shared, highlights: [laterQuote], queries: ["later"] };
  const state: Checkpoint = {
    sources: selectSources([shared, later]),
    searches: { first: [shared], later: [later] },
  };
  const seen: string[] = [];
  const result = await analyzeQueryResults(
    "Question",
    state,
    signal(),
    async () => {},
    {
      deduplicate: async () => ({}),
      summarize: async (_question, query, sources) => {
        seen.push(sources[0].highlights[0]);
        return {
          ...emptySummary(),
          findings: [
            {
              topic: query,
              claim: `Finding for ${query}.`,
              evidence: [
                { sourceId: sources[0].id, quote: sources[0].highlights[0] },
              ],
            },
          ],
        };
      },
      fetchContext: async () => {
        throw new Error("No context requested");
      },
      merge: async (summaries) => ({
        findings: Object.values(summaries).flatMap((s) => s.findings),
        gaps: [],
        followUpQueries: [],
      }),
    },
  );
  assert.deepEqual(seen, [shared.highlights[0], laterQuote]);
  assert.equal(groundedFindings(result, state.sources!).findings.length, 2);
});

test("unavailable context leaves an explicit gap and cannot support a dependent claim", async () => {
  const s = source(0);
  const state: Checkpoint = { sources: [s], searches: { query: [s] } };
  const result = await analyzeQueryResults(
    "Question",
    state,
    signal(),
    async () => {},
    {
      deduplicate: async () => ({}),
      summarize: async () => ({
        ...emptySummary(),
        findings: [
          {
            topic: "Methods",
            claim: "A claim requiring context.",
            evidence: [{ sourceId: s.id, quote: s.highlights[0] }],
          },
        ],
        needsContext: [
          { sourceId: s.id, reason: "Methodology is incomplete." },
        ],
      }),
      fetchContext: async () => "",
      merge: async (summaries) => ({
        findings: summaries.query.findings,
        gaps: summaries.query.unansweredQuestions,
        followUpQueries: [],
      }),
    },
  );
  assert.equal(result.findings.length, 0);
  assert.ok(result.gaps.some((gap) => gap.includes("Context unresolved")));
});

test("ten full result excerpts leave room for a correction within the default token allowance", async (t) => {
  const sources = Array.from({ length: 10 }, (_, i) => ({
    ...source(i),
    title: "Long descriptive source title ".repeat(5),
    highlights: [
      "Relevant research detail. ".repeat(100),
      "Additional study context. ".repeat(100),
    ],
  }));
  const seen = new Map<string, string[]>();
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    const input = JSON.parse(request.messages[1].content);
    for (const source of input.sources) {
      seen.set(source.sourceId, [
        ...(seen.get(source.sourceId) ?? []),
        ...source.excerpts,
      ]);
    }
    const estimated =
      Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 3) +
      request.max_tokens * 2;
    assert.ok(
      estimated <= 8000,
      `Estimated correction reservation ${estimated}`,
    );
    return response(emptySummary());
  });
  await summarizeQuery(
    "What does the research show?",
    "study methods",
    sources,
    signal(),
  );
  for (const source of sources) {
    assert.equal(seen.get(source.id)?.join(""), source.highlights.join(""));
  }
});

test("non-English excerpts stay within byte budgets and remain exact substrings", async (t) => {
  const sources = Array.from({ length: 10 }, (_, i) => ({
    ...source(i),
    title: "研究結果".repeat(50),
    highlights: [
      "研究の方法と結果について説明します。".repeat(100),
      "追加の証拠と制約について説明します。".repeat(100),
    ],
  }));
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    const input = JSON.parse(request.messages[1].content);
    assert.ok(
      Math.ceil(Buffer.byteLength(JSON.stringify(request)) / 3) +
        request.max_tokens * 2 <
        8000,
    );
    for (const supplied of input.sources) {
      const original = sources.find((s) => s.id === supplied.sourceId)!;
      for (const excerpt of supplied.excerpts) {
        assert.ok(original.highlights.some((h) => h.includes(excerpt)));
        assert.ok(!excerpt.includes("�"));
      }
    }
    return response(emptySummary());
  });
  await summarizeQuery(
    "Describe the research.",
    "study methods",
    sources,
    signal(),
  );
});

test("verbose summary metadata normalizes before grounding and preserves context requests", async (t) => {
  const sources = [source(0), source(1), source(2)];
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      findings: sources.map((s, i) => ({
        topic: "Results",
        claim: `Finding ${i}`,
        evidence: [
          {
            sourceId: s.id,
            quote:
              i === 2
                ? "An invented quotation without support."
                : s.highlights[0],
          },
        ],
      })),
      unansweredQuestions: [
        { question: "Which period?", reason: "Dates need checking." },
      ],
      needsContext: sources.map((s) => ({
        sourceId: s.id,
        reason: "More context is required. ".repeat(30),
      })),
      disagreements: [
        {
          topic: "Different reporting periods. ".repeat(20),
          findingIndexes: [0, 1],
        },
      ],
    });
  });
  const result = await summarizeQuery("Question", "metrics", sources, signal());
  assert.equal(calls, 1);
  assert.equal(result.findings.length, 2);
  assert.equal(result.needsContext.length, 3);
  assert.ok(result.needsContext.every((r) => r.reason.length <= 200));
  assert.ok(result.disagreements[0].topic.length <= 100);
  assert.ok(
    result.unansweredQuestions.includes("Which period? Dates need checking."),
  );
});

test("query summaries retry truncation with a larger reserved output allowance", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    assert.equal(request.max_tokens, calls === 1 ? 2400 : 4800);
    if (calls === 1) {
      return {
        choices: [
          { finish_reason: "length", message: { content: '{"findings":[' } },
        ],
      };
    }

    return response(emptySummary());
  });
  assert.deepEqual(
    await summarizeQuery("Question", "metrics", [source(0)], signal()),
    emptySummary(),
  );
  assert.equal(calls, 2);
});

test("query summary normalization does not coerce arbitrary question objects", async (t) => {
  t.mock.method(client.chat.completions, "create", async () =>
    response({
      ...emptySummary(),
      unansweredQuestions: [{ question: 42 }],
    }),
  );
  await assert.rejects(
    summarizeQuery("Question", "metrics", [source(0)], signal()),
    /required schema/,
  );
});

test("text-only structured unanswered questions normalize in one request", async (t) => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      ...emptySummary(),
      unansweredQuestions: [
        {
          topic: "Revenue",
          question: "Are periods comparable?",
          missingData: ["Quarter dates", "Currency basis"],
        },
        ["Which entity?", "Consolidated or subsidiary?"],
        {
          question: {
            text: "Which measure?",
            qualification: "Definitions differ.",
          },
        },
      ],
    });
  });
  const result = await summarizeQuery(
    "Question",
    "metrics",
    [source(0)],
    signal(),
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.unansweredQuestions, [
    "topic: Revenue; question: Are periods comparable?; missingData: Quarter dates; Currency basis",
    "Which entity?; Consolidated or subsidiary?",
    "question: text: Which measure?; qualification: Definitions differ.",
  ]);
  assert.deepEqual(result.findings, []);
});

test("question normalization rejects nontext leaves and leaves claims and quotes unchanged", async () => {
  const { normalizeQuerySummary } =
    await import("../../lib/modelOutputNormalization.js");
  const { querySummarySchema } =
    await import("../../zodSchema/queryEvidence.schema.js");
  for (const item of [
    null,
    42,
    true,
    {},
    [],
    { question: "Which period?", detail: null },
    { details: ["A note", 42] },
  ]) {
    assert.equal(
      querySummarySchema.safeParse(
        normalizeQuerySummary({
          ...emptySummary(),
          unansweredQuestions: [item],
        }),
      ).success,
      false,
    );
  }
  const findings = [
    {
      topic: "Metrics",
      claim: "x".repeat(301),
      evidence: [{ sourceId: "S1", quote: "y".repeat(1201) }],
    },
  ];
  const normalized = normalizeQuerySummary({
    ...emptySummary(),
    findings,
  }) as any;
  assert.deepEqual(normalized.findings, findings);
  assert.equal(querySummarySchema.safeParse(normalized).success, false);
});

test("long exact quotes survive unchanged while oversized invented evidence drops its whole claim", async (t) => {
  const quote =
    "The study reports a measured result with important qualifications. ".repeat(
      9,
    );
  assert.ok(quote.length > 450 && quote.length < 1200);
  const s = { ...source(0), highlights: [quote] };
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      ...emptySummary(),
      findings: [
        {
          topic: "Results",
          claim: "A supported detail.",
          evidence: [{ sourceId: s.id, quote }],
        },
        {
          topic: "Results",
          claim: "Unsupported compound claim.",
          evidence: [
            { sourceId: s.id, quote },
            { sourceId: s.id, quote: "An invented passage. ".repeat(80) },
          ],
        },
        {
          topic: "Results",
          claim: "Another supported detail.",
          evidence: [{ sourceId: s.id, quote }],
        },
      ],
      disagreements: [
        { topic: "Retained", findingIndexes: [0, 2] },
        { topic: "Removed", findingIndexes: [0, 1] },
      ],
    });
  });
  const result = await summarizeQuery("Question", "results", [s], signal());
  assert.equal(calls, 1);
  assert.deepEqual(
    result.findings.map((f) => f.claim),
    ["A supported detail.", "Another supported detail."],
  );
  assert.ok(result.findings.every((f) => f.evidence[0].quote === quote));
  assert.deepEqual(result.disagreements, [
    { topic: "Retained", findingIndexes: [0, 1] },
  ]);
  assert.match(result.unansweredQuestions[0], /omitted/);
});

test("exact quotes beyond the downstream limit still require model correction", async (t) => {
  const quote = "Exact source passage with qualifications. ".repeat(32);
  assert.ok(quote.length > 1200);
  const s = { ...source(0), highlights: [quote] };
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async () => {
    calls++;
    return response({
      ...emptySummary(),
      findings: [
        {
          topic: "Results",
          claim: "A detail.",
          evidence: [{ sourceId: s.id, quote }],
        },
      ],
    });
  });
  await assert.rejects(
    summarizeQuery("Question", "results", [s], signal()),
    /required schema/,
  );
  assert.equal(calls, 2);
});
