import { selectSources } from "../services/evidence.service.js";
import { PermanentError, RunStopped } from "../lib/errors.js";
import { renderReport } from "../services/report.service.js";
import type { Checkpoint, ResearchStatus } from "../types/research.js";
import type { PipelineDeps, RunRecord } from "../types/pipeline.js";
import { maxProviderCalls } from "../config/researchLimits.js";
import { withProviderCalls } from "../lib/providerCalls.js";
export type { PipelineDeps, RunRecord } from "../types/pipeline.js";

export async function runPipeline(
  record: RunRecord,
  deps: PipelineDeps,
  signal: AbortSignal,
) {
  const state: Checkpoint = structuredClone(record.checkpoint);
  const check = async () => {
    if (signal.aborted) throw new RunStopped("Run stopped");
    if (Date.now() - record.startedAt.getTime() > 15 * 60_000)
      throw new PermanentError(
        "Research exceeded its fifteen-minute time budget.",
      );
    await deps.check();
  };
  const save = async (
    status: ResearchStatus,
    progress: number,
    report?: string,
  ) => {
    await check();
    await deps.save(state, status, progress, report);
  };
  const reserve = async (status: ResearchStatus, progress: number) => {
    await check();
    if ((state.calls || 0) >= maxProviderCalls)
      throw new PermanentError(
        `Research reached its provider-call budget (${maxProviderCalls} calls across all attempts).`,
      );
    state.calls = (state.calls || 0) + 1;
    await save(status, progress);
  };
  const execute = async <T>(
    status: ResearchStatus,
    progress: number,
    action: () => Promise<T>,
  ) => {
    await reserve(status, progress);
    return withProviderCalls(() => reserve(status, progress), action);
  };
  if (!state.plan) {
    state.plan = await execute("planning", 5, () =>
      deps.plan(record.question, record.depth, record.scope, signal),
    );
    state.plan.queries = [...new Set(state.plan.queries)].slice(
      0,
      record.depth === "Quick overview" ? 3 : 6,
    );
    await save("planning", 15);
  }
  state.searches ||= {};
  // Older checkpoints stored review searches without adding them to the plan.
  state.plan.queries = [
    ...new Set([...state.plan.queries, ...Object.keys(state.searches)]),
  ];
  if (!state.searchComplete) {
    state.searches = await execute("searching", 20, () =>
      deps.search(
        state.searches!,
        record.question,
        state.plan!,
        record.scope,
        signal,
        () => save("searching", 35),
      ),
    );
    state.searchComplete = true;
    await save("searching", 50);
  }
  state.sources = selectSources(Object.values(state.searches).flat());
  if (!state.sources.length)
    throw new PermanentError(
      "No usable source excerpts were found. Try a more specific research question.",
    );
  await save("analyzing", 55);
  if (!state.analysis) {
    state.analysis = await execute("analyzing", 60, () =>
      deps.analyze(record.question, state.sources!, signal),
    );
    await save("analyzing", 78);
  }
  // Follow-up retrieval is performed by the search-review pipeline before analysis.
  if (!state.verified) {
    state.verified = await execute("generating_report", 85, () =>
      deps.verify(record.question, state.analysis!, state.sources!, signal),
    );
    await save("generating_report", 92);
  }
  if (!state.verified.findings.length)
    throw new PermanentError(
      "The retrieved evidence did not support a reliable answer. Try narrowing the question.",
    );
  if (!state.reportLayout || (deps.present && !state.reportLayout.summary)) {
    state.reportLayout = deps.present
      ? await execute("generating_report", 94, () =>
          deps.present!(record.question, state.verified!, signal),
        )
      : {
          overview: [],
          sections: [
            {
              heading: "Key findings",
              findingIndexes: state.verified!.findings.map((_, i) => i),
            },
          ],
        };
    await save("generating_report", 97);
  }
  await save(
    "completed",
    100,
    renderReport(
      record.question,
      state.verified,
      state.sources,
      state.reportLayout,
    ),
  );
  return {
    sources: state.sources.length,
    findings: state.verified.findings.length,
  };
}
