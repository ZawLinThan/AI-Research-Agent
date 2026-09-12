import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runPipeline,
  type RunRecord,
  type PipelineDeps,
} from "../../pipeline/run.js";
import {
  groundedFindings,
  selectSources,
  sourceId,
} from "../evidence.service.js";
import { PermanentError, RunStopped, retryable } from "../../lib/errors.js";
import {
  planSchema,
  type Source,
  type Analysis,
} from "../../../../shared/research.js";
const url = "https://example.com/article";
const source: Source = {
  id: sourceId(url),
  url,
  title: "Evidence",
  highlights: ["Redis stores the queue state used by BullMQ workers."],
  queries: ["q1"],
  retrievedAt: new Date().toISOString(),
};
const analysis: Analysis = {
  findings: [
    {
      claim: "BullMQ workers use Redis queue state.",
      evidence: [{ sourceId: source.id, quote: source.highlights[0] }],
    },
  ],
  gaps: [],
  followUpQueries: [],
};
function fixture() {
  const record: RunRecord = {
    id: "test",
    question: "How do queues work?",
    depth: "Quick overview",
    scope: "Web",
    checkpoint: {},
    startedAt: new Date(),
  };
  const states: string[] = [];
  let searchCalls: string[] = [];
  const deps: PipelineDeps = {
    check: async () => {},
    save: async (state, status) => {
      record.checkpoint = structuredClone(state);
      states.push(status);
    },
    plan: async () => ({ queries: ["q1", "q2"] }),
    search: async (query) => {
      searchCalls.push(query);
      return [source];
    },
    analyze: async () => analysis,
    verify: async () => analysis,
  };
  return { record, deps, states, searchCalls };
}
test("complete a cited report only after verification", async () => {
  const f = fixture();
  let report = "";
  const save = f.deps.save;
  f.deps.save = async (s, status, p, text) => {
    await save(s, status, p, text);
    if (text) report = text;
  };
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.equal(f.states.at(-1), "completed");
  assert.match(report, new RegExp(source.id));
  assert.ok(report.includes(source.url));
});
test("resume from a persisted search checkpoint after provider failure", async () => {
  const f = fixture();
  const search = f.deps.search;
  f.deps.search = async (q, s, a) => {
    if (q === "q2")
      throw Object.assign(new Error("rate limited"), { status: 429 });
    return search(q, s, a);
  };
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
  );
  assert.ok(!f.states.includes("completed"));
  f.deps.search = search;
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.deepEqual(f.searchCalls, ["q1", "q2"]);
});
test("cancellation prevents completed writes", async () => {
  const f = fixture();
  f.deps.check = async () => {
    if (f.record.checkpoint.plan) throw new RunStopped("cancelled");
  };
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
    RunStopped,
  );
  assert.ok(!f.states.includes("completed"));
});
test("insufficient evidence fails instead of reporting success", async () => {
  const f = fixture();
  f.deps.search = async () => [];
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
    /No usable/,
  );
  assert.ok(!f.states.includes("completed"));
});
test("unsupported findings do not produce a completed report", async () => {
  const f = fixture();
  f.deps.verify = async () => ({ ...analysis, findings: [] });
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
    /did not support/,
  );
  assert.ok(!f.states.includes("completed"));
});
test("provider budgets and deadlines survive retries", async () => {
  const f = fixture();
  f.record.checkpoint.calls = 16;
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
    /budget/,
  );
  f.record.checkpoint = {};
  f.record.startedAt = new Date(Date.now() - 9 * 60_000);
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
    /time budget/,
  );
});
test("deduplicate tracking URLs and reject invented citations", () => {
  assert.equal(
    selectSources([source, { ...source, url: url + "?utm_source=x" }]).length,
    1,
  );
  assert.equal(
    groundedFindings(
      {
        ...analysis,
        findings: [
          {
            ...analysis.findings[0],
            evidence: [{ sourceId: "fake", quote: source.highlights[0] }],
          },
        ],
      },
      [source],
    ).findings.length,
    0,
  );
  assert.equal(
    groundedFindings(
      {
        ...analysis,
        findings: [
          {
            ...analysis.findings[0],
            evidence: [
              {
                sourceId: source.id,
                quote: "This quote was never in the retrieved page.",
              },
            ],
          },
        ],
      },
      [source],
    ).findings.length,
    0,
  );
});
test("validate planner shape and transient retry classification", () => {
  assert.equal(planSchema.safeParse(["query"]).success, false);
  assert.equal(retryable({ status: 429 }), true);
  assert.equal(retryable({ status: 503 }), true);
  assert.equal(retryable({ status: 401 }), false);
  assert.equal(retryable(new PermanentError("invalid")), false);
});
