import { maxProviderCalls } from "../../config/researchLimits.js";
import { beforeProviderCall } from "../../lib/providerCalls.js";
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
    checkpoint: { planApproved: true },
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
    search: async (searches, _question, plan, _scope, _signal, checkpoint) => {
      for (const query of plan.queries) {
        if (searches[query]) continue;
        searchCalls.push(query);
        searches[query] = [source];
        await checkpoint();
      }
      return searches;
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
  f.deps.search = async (
    searches,
    question,
    plan,
    scope,
    signal,
    checkpoint,
  ) => {
    await search(
      searches,
      question,
      { queries: [plan.queries[0]] },
      scope,
      signal,
      checkpoint,
    );
    throw Object.assign(new Error("rate limited"), { status: 429 });
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
  f.deps.search = async () => ({});
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
  f.record.checkpoint.calls = maxProviderCalls;
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
    /budget/,
  );
  f.record.checkpoint = {};
  f.record.startedAt = new Date(Date.now() - 61 * 60_000);
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

test("deep research can finish with all review rounds and model corrections", async () => {
  const f = fixture();
  f.record.depth = "Deep research";
  const calls = async (count: number) => {
    for (let i = 0; i < count; i++) await beforeProviderCall();
  };
  f.deps.plan = async () => {
    await calls(12); // Initial plan, two revisions, three reviews, each corrected once.
    return { queries: Array.from({ length: 6 }, (_, i) => `query ${i}`) };
  };
  f.deps.search = async () => {
    await calls(16); // Six initial + four follow-up searches; three corrected reviews.
    return { evidence: [source] };
  };
  f.deps.analyze = async () => {
    await calls(2);
    return analysis;
  };
  f.deps.verify = async () => {
    await calls(2);
    return analysis;
  };
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.equal(f.record.checkpoint.calls, 32);
  assert.equal(f.states.at(-1), "completed");
});

test("nested calls cannot bypass the remaining budget on a retried run", async () => {
  const f = fixture();
  f.record.checkpoint.calls = maxProviderCalls - 1;
  let requests = 0;
  f.deps.plan = async () => {
    await beforeProviderCall();
    requests++;
    await beforeProviderCall();
    requests++;
    return { queries: ["query"] };
  };
  await assert.rejects(
    runPipeline(f.record, f.deps, new AbortController().signal),
    /provider-call budget/,
  );
  assert.equal(requests, 1);
  assert.equal(f.record.checkpoint.calls, maxProviderCalls);
});

test("planning pauses and retries never search before approval", async () => {
  const f = fixture();
  f.record.checkpoint = {};
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.equal(f.states.at(-1), "awaiting_approval");
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.deepEqual(f.searchCalls, []);
  f.record.checkpoint = { plan: { queries: ["edited query"] }, planApproved: true };
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.deepEqual(f.searchCalls, ["edited query"]);
  assert.equal(f.states.at(-1), "completed");
});

test("search executes only approved queries without automatic follow-ups", async () => {
  const { searchForSources } = await import("../../pipeline/search.pipeline.js");
  const searched: string[] = [];
  await searchForSources({}, "question", { queries: ["approved"] }, "Web", new AbortController().signal, async () => {}, {
    search: async query => { searched.push(query); return [source]; },
    review: async () => { throw new Error("Must not generate unapproved queries"); },
  });
  assert.deepEqual(searched, ["approved"]);
});

test("resumed layouts without a summary are regenerated and checkpointed", async () => {
  const f = fixture();
  f.record.checkpoint.reportLayout = {
    overview: [0],
    sections: [{ heading: "Details", findingIndexes: [0] }],
  };
  let calls = 0;
  f.deps.present = async () => {
    calls++;
    return {
      summary: "Queue processing relies on Redis-backed state.",
      overview: [0],
      sections: [{ heading: "Details", findingIndexes: [0] }],
    };
  };
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(
    f.record.checkpoint.reportLayout?.summary,
    "Queue processing relies on Redis-backed state.",
  );
});

test("an omitted unsupported summary is checkpointed and not regenerated on resume", async () => {
  const f = fixture();
  let presentations = 0;
  f.deps.present = async () => {
    presentations++;
    return { summaryOmitted: true, overview: [0], sections: [{ heading: "Supported findings", findingIndexes: [0] }], limitations: ["A complete answer could not be validated."] };
  };
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.equal(f.record.checkpoint.reportLayout?.summaryOmitted, true);
  await runPipeline(f.record, f.deps, new AbortController().signal);
  assert.equal(presentations, 1);
});
