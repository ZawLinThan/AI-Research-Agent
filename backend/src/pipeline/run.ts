import type {
  Checkpoint,
  ResearchStatus,
  Source,
  Analysis,
  ResearchPlan,
} from "../../../shared/research.js";
import { selectSources } from "../services/evidence.service.js";
import { PermanentError, RunStopped } from "../lib/errors.js";
import { renderReport } from "../services/report.service.js";

export type RunRecord = {
  id: string;
  question: string;
  depth: string;
  scope: string;
  checkpoint: Checkpoint;
  startedAt: Date;
};

export type PipelineDeps = {
  save: (
    state: Checkpoint,
    status: ResearchStatus,
    progress: number,
    report?: string,
  ) => Promise<void>;
  check: () => Promise<void>;
  plan: (
    question: string,
    depth: string,
    scope: string,
    signal: AbortSignal,
  ) => Promise<ResearchPlan>;
  search: (
    query: string,
    scope: string,
    signal: AbortSignal,
  ) => Promise<Source[]>;
  analyze: (
    question: string,
    sources: Source[],
    signal: AbortSignal,
  ) => Promise<Analysis>;
  verify: (
    question: string,
    analysis: Analysis,
    sources: Source[],
    signal: AbortSignal,
  ) => Promise<Analysis>;
};

export async function runPipeline(
  record: RunRecord,
  deps: PipelineDeps,
  signal: AbortSignal,
) {
  const state: Checkpoint = structuredClone(record.checkpoint);

  const check = async () => {
    if (signal.aborted) throw new RunStopped("Run stopped");
    if (Date.now() - record.startedAt.getTime() > 8 * 60_000)
      throw new PermanentError(
        "Research exceeded its eight-minute time budget.",
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
    if ((state.calls || 0) >= 16)
      throw new PermanentError("Research reached its provider-call budget.");
    state.calls = (state.calls || 0) + 1;
    await save(status, progress);
  };

  if (!state.plan) {
    await reserve("planning", 5);
    state.plan = await deps.plan(
      record.question,
      record.depth,
      record.scope,
      signal,
    );
    state.plan.queries = [...new Set(state.plan.queries)].slice(
      0,
      record.depth === "Quick overview" ? 2 : 4,
    );
    await save("planning", 15);
  }

  state.searches ||= {};

  for (const query of state.plan.queries) {
    if (state.searches[query]) continue;
    await reserve("searching", 20);
    state.searches[query] = await deps.search(query, record.scope, signal);
    await save(
      "searching",
      Math.min(50, 20 + Object.keys(state.searches).length * 7),
    );
  }

  state.sources = selectSources(Object.values(state.searches).flat());

  if (!state.sources.length)
    throw new PermanentError(
      "No usable source excerpts were found. Try a more specific research question.",
    );

  await save("analyzing", 55);

  if (!state.analysis) {
    await reserve("analyzing", 60);
    state.analysis = await deps.analyze(record.question, state.sources, signal);
    await save("analyzing", 65);
  }

  if (!state.followUpDone) {
    const query =
      record.depth === "Deep research"
        ? state.analysis.followUpQueries[0]
        : undefined;
    if (query && !state.searches[query]) {
      await reserve("searching", 68);
      state.searches[query] = await deps.search(query, record.scope, signal);
      await save("searching", 70);
    }
    if (query) {
      state.sources = selectSources(Object.values(state.searches).flat());
      await reserve("analyzing", 72);
      state.analysis = await deps.analyze(
        record.question,
        state.sources,
        signal,
      );
    }
    state.followUpDone = true;
    await save("analyzing", 78);
  }

  if (!state.verified) {
    await reserve("generating_report", 85);
    state.verified = await deps.verify(
      record.question,
      state.analysis,
      state.sources,
      signal,
    );
    await save("generating_report", 92);
  }

  if (!state.verified.findings.length)
    throw new PermanentError(
      "The retrieved evidence did not support a reliable answer. Try narrowing the question.",
    );

  const report = renderReport(record.question, state.verified, state.sources);

  await save("completed", 100, report);
  
  return {
    sources: state.sources.length,
    findings: state.verified.findings.length,
  };
}
