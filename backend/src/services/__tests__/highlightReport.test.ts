import { test } from "node:test";
import assert from "node:assert/strict";
import { client } from "../../config/openRouterAI.js";
import { summarizeHighlights, highlightSources, composeHighlightReport } from "../highlightReport.service.js";
import { runPipeline, type PipelineDeps, type RunRecord } from "../../pipeline/run.js";
import type { Source } from "../../types/research.js";
const source: Source = { id: "original", url: "https://example.com/article", title: "Source", highlights: ["An original supporting highlight.", "A second useful highlight."], queries: ["query one"], retrievedAt: new Date().toISOString() };
const response = (data: unknown) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(data) } }] });

test("query call requests only summary and receives every highlight", async t => {
  let calls = 0;
  t.mock.method(client.chat.completions, "create", async (request: any) => {
    calls++;
    const input = JSON.parse(request.messages[1].content);
    assert.deepEqual(input.sources[0].highlights, source.highlights);
    assert.ok(request.messages[0].content.includes('Required top-level fields: summary.'));
    return response({ summary: "A summary of the highlights." });
  });
  assert.deepEqual(await summarizeHighlights("Question", "query one", [source], new AbortController().signal), { summary: "A summary of the highlights." });
  assert.equal(calls, 1);
});

test("new summary path skips legacy extraction and resumes summaries before gaps and report", async () => {
  const record: RunRecord = { id: "test", question: "Original question", depth: "Deep research", scope: "Web", startedAt: new Date(), checkpoint: {
    planApproved: true, plan: { queries: ["query one", "query two"] }, searchComplete: true,
    searches: { "query one": [source], "query two": [{ ...source, highlights: ["Query two specific evidence."] }] },
    analysis: { findings: [], gaps: ["old gap"], followUpQueries: [] },
  } };
  const events: string[] = [];
  let fail = true, report = "";
  const unexpected = async (): Promise<never> => { throw new Error("Legacy stage must not run"); };
  const deps: PipelineDeps = {
    check: async () => {}, save: async (state, _status, _progress, text) => { record.checkpoint = structuredClone(state); if (text) report = text; },
    plan: unexpected, search: unexpected, analyze: unexpected, analyzeQueries: unexpected, verify: unexpected, present: unexpected,
    highlights: {
      summarize: async (_question, query, sources) => {
        events.push(query);
        if (query === "query two" && fail) throw new Error("Temporary provider failure");
        if (query === "query two") assert.deepEqual(sources[0].highlights, ["Query two specific evidence."]);
        return { summary: `Summary ${query}` };
      },
      gaps: async (_question, summaries) => { events.push("gaps"); assert.equal(summaries.length, 2); return { gaps: ["A final gap"] }; },
      report: async (_question, state) => { events.push("report"); assert.deepEqual(state.highlightReport?.gaps, ["A final gap"]); return "Final report"; },
    },
  };
  await assert.rejects(runPipeline(record, deps, new AbortController().signal), /Temporary/);
  fail = false;
  await runPipeline(record, deps, new AbortController().signal);
  assert.deepEqual(events, ["query one", "query two", "query two", "gaps", "report"]);
  assert.equal(report, "Final report");
  await runPipeline(record, deps, new AbortController().signal);
  assert.equal(events.length, 5);
});

test("report reuses query summaries and renders selected original highlights with citations and final gaps", async t => {
  const sources = highlightSources([source]);
  t.mock.method(client.chat.completions, "create", async () => response({ summary: "Overall synthesis.", supports: [{ queryIndex: 0, passageIndexes: [1, 1, 900] }] }));
  const report = await composeHighlightReport("Original question", {
    plan: { queries: ["query one"] }, sources, searches: { "query one": sources },
    highlightReport: { summaries: { "query one": { summary: "Saved query summary." } }, gaps: ["A missing comparison."] },
  }, new AbortController().signal);
  assert.ok(report.includes("- Saved query summary.\n  - A second useful highlight."));
  assert.ok(report.includes(`[${sources[0].id}]`));
  assert.ok(report.includes("- A missing comparison."));
  assert.equal(report.split("A second useful highlight.").length - 1, 1);
});

test("highlight source preparation does not truncate or lose same-URL excerpts", () => {
  const long = "Evidence with qualifications. ".repeat(100);
  const sources = highlightSources([source, { ...source, highlights: [long] }]);
  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0].highlights, [...source.highlights, long]);
});
