import { comparisonCoverageGaps } from "../services/evidenceReport.service.js";
import { planIssues } from "../services/planner.service.js";
import { reviewSearch } from "../services/search.service.js";
import { highlightSources } from "../services/highlightReport.service.js";
import { selectSources } from "../services/evidence.service.js";
import { PermanentError, RunStopped } from "../lib/errors.js";
import { renderReport } from "../services/report.service.js";
import type { Checkpoint, ResearchStatus } from "../types/research.js";
import type { PipelineDeps, RunRecord } from "../types/pipeline.js";
import {
  maxProviderCalls,
  researchTimeBudgetMs,
  researchTimeBudgetMessage,
} from "../config/researchLimits.js";
import { withProviderCalls } from "../lib/providerCalls.js";

export type { PipelineDeps, RunRecord } from "../types/pipeline.js";

export async function runPipeline(
  record: RunRecord,
  deps: PipelineDeps,
  signal: AbortSignal,
) {
  const state: Checkpoint = structuredClone(record.checkpoint);

  const check = async () => {
    if (signal.aborted) {
      throw new RunStopped("Run stopped");
    }

    if (Date.now() - record.startedAt.getTime() > researchTimeBudgetMs) {
      throw new PermanentError(researchTimeBudgetMessage);
    }

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

    if ((state.calls || 0) >= maxProviderCalls) {
      throw new PermanentError(
        `Research reached its provider-call budget (${maxProviderCalls} calls across all attempts).`,
      );
    }

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
      deps.plan(
        record.question,
        record.depth,
        record.scope,
        signal,
        async (plan) => {
          state.planningDraft = plan;
          await save("planning", 10);
        },
      ),
    );

    await save("planning", 15);
  }

  if (!state.planApproved) {
    await save("awaiting_approval", 15);

    return { awaitingApproval: true };
  }

  const issues = planIssues(state.plan, record.depth);

  if (issues.length) {
    throw new PermanentError(`Approved plan is invalid: ${issues.join(" ")}`);
  }

  state.searches ||= {};

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

  if (deps.highlights) {
    const progress = (state.highlightReport ??= { summaries: {} });

    // Reuse retrieval checkpoints, but never reuse legacy extracted findings.
    state.sources = highlightSources(
      state.plan.queries.flatMap((query) => state.searches![query] ?? []),
    );

    for (const query of state.plan.queries) {
      if (Object.hasOwn(progress.summaries, query)) {
        continue;
      }

      const sources = highlightSources(state.searches[query] ?? []);
      const summary = sources.some((source) => source.highlights.length)
        ? await execute("analyzing", 60, () =>
            deps.highlights!.summarize(record.question, query, sources, signal),
          )
        : { summary: "No source highlights were retrieved for this query." };

      progress.summaries = { ...progress.summaries, [query]: summary };

      await save("analyzing", 78);
    }

    if (!progress.gaps) {
      progress.gaps = (
        await execute("analyzing", 85, () =>
          deps.highlights!.gaps(
            record.question,
            state.plan!.queries.map((query) => ({
              query,
              summary: progress.summaries[query].summary,
            })),
            signal,
          ),
        )
      ).gaps;

      await save("analyzing", 90);
    }

    // Give report selection canonical source IDs while retaining every highlight.
    state.searches = Object.fromEntries(
      state.plan.queries.map((query) => [
        query,
        highlightSources(state.searches![query] ?? []),
      ]),
    );

    if (!progress.report) {
      progress.report = await execute("generating_report", 94, () =>
        deps.highlights!.report(record.question, state, signal),
      );

      await save("generating_report", 97);
    }

    await save("completed", 100, progress.report);

    return {
      sources: state.sources.length,
      queries: state.plan.queries.length,
    };
  }

  if (deps.extractRecords && state.evidencePipelineVersion !== 2) {
    state.analysis = undefined;
    state.verified = undefined;
    state.reportLayout = undefined;
    state.evidenceRecords = undefined;
    state.extractedSourceIds = undefined;
    state.reportClaims = undefined;
  }

  if (!state.evidence) {
    state.sources = selectSources(Object.values(state.searches).flat());
    console.log("Source selection completed.");

    if (deps.analyzeQueries) {
      // Upgrade unfinished legacy runs to the per-query evidence workflow.
      state.analysis = undefined;
      state.verified = undefined;
      state.reportLayout = undefined;
    }
  }

  if (!state.sources?.length) {
    throw new PermanentError(
      "No usable source excerpts were found. Try a more specific research question.",
    );
  }

  await save("analyzing", 55);

  if (!state.searchReview && deps.reviewSearch) {
    state.searchReview = await execute("analyzing", 56, () =>
      deps.reviewSearch!(record.question, state.plan!, state.searches!, signal),
    );

    await save("analyzing", 58);
  }

  if (!state.analysis && deps.extractRecords) {
    await execute("analyzing", 60, () =>
      deps.extractRecords!(record.question, state.sources!, state, signal, () =>
        save("analyzing", 65),
      ),
    );
  }

  if (!state.analysis) {
    state.analysis = await execute("analyzing", 60, () =>
      deps.synthesize && state.evidenceRecords
        ? deps.synthesize(
            record.question,
            state.evidenceRecords,
            state.sources!,
            state,
            signal,
          )
        : deps.analyzeQueries
          ? deps.analyzeQueries(record.question, state, signal, () =>
              save("analyzing", 65),
            )
          : deps.analyze(record.question, state.sources!, signal),
    );

    // Raw search review precedes evidence extraction and cannot establish final gaps.
    if (!deps.synthesize) {
      state.analysis.gaps.push(
        ...(state.searchReview?.missingEvidence ?? []),
        ...(state.searchReview?.weakAreas ?? []),
      );
    }

    state.evidenceRecords ??= state.analysis.findings.flatMap((finding, i) =>
      finding.evidence.map((e, j) => {
        const source = state.sources!.find((s) => s.id === e.sourceId)!;

        return {
          id: `E${i + 1}-${j + 1}`,
          claim: finding.claim,
          quote: e.quote,
          sourceUrl: source.url,
          sourceTitle: source.title,
          publishedAt: source.publishedAt,
        };
      }),
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

  if (deps.synthesize && state.plan?.brief?.answerShape === "comparison") {
    const retainedClaims =
      state.reportClaims?.filter((c) =>
        state.verified!.findings.some((f) => f.claim === c.text),
      ) ?? [];
    const retainedIds = new Set(retainedClaims.flatMap((c) => c.evidenceIds));

    state.verified.gaps = comparisonCoverageGaps(
      (state.evidenceRecords ?? []).filter((e) => retainedIds.has(e.id)),
      state,
    );

    if (state.evidenceRejections?.length) {
      state.verified.gaps.push(
        "Ambiguous or mismatched source attributions were omitted.",
      );
    }
  }

  if (!state.verified.findings.length) {
    throw new PermanentError(
      "The retrieved evidence did not support a reliable answer. Try narrowing the question.",
    );
  }

  if (
    !state.reportLayout ||
    (deps.synthesize &&
      state.plan?.brief?.answerShape === "comparison" &&
      state.reportLayout.reportVersion !== 2) ||
    (deps.present &&
      !state.reportLayout.summary &&
      !state.reportLayout.summaryOmitted)
  ) {
    state.reportLayout = deps.present
      ? await execute("generating_report", 94, () =>
          deps.present!(record.question, state.verified!, signal, state),
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

  state.reportClaims = state.reportClaims
    ? state.reportClaims.filter((c) =>
        state.verified!.findings.some((f) => f.claim === c.text),
      )
    : state.verified.findings.map((f) => ({
        text: f.claim,
        evidenceIds: (state.evidenceRecords ?? [])
          .filter(
            (e) =>
              e.claim === f.claim &&
              f.evidence.some((q) => q.quote === e.quote),
          )
          .map((e) => e.id),
      }));

  if (state.reportClaims.some((c) => !c.evidenceIds.length)) {
    throw new PermanentError(
      "Report contains an unsupported evidence reference.",
    );
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
