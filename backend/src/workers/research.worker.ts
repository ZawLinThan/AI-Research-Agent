import {
  extractEvidenceRecords,
  synthesizeEvidence,
} from "../services/evidenceReport.service.js";
import { reviewSearch } from "../services/search.service.js";
import { queuedSearch, closeSearchQueue } from "../queues/search.queue.js";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { cancelLostLocks, deferLostLock } from "../lib/workerLock.js";
import "../lib/workerLoggingBootstrap.js";
import { workerLogging } from "../lib/workerLogging.js";
import {
  configureProviderScheduler,
  ProviderScheduler,
  RedisProviderGate,
  providerBackoff,
} from "../lib/providerRateLimit.js";
import {
  openRouterTokensPerMinute,
  openRouterRequestsPerMinute,
  researchWorkerConcurrency,
  researchLockDurationMs,
  researchTimeBudgetMs,
  researchTimeBudgetMessage,
} from "../config/researchLimits.js";
import { Worker, UnrecoverableError } from "bullmq";
import {
  RESEARCH_QUEUE,
  researchQueue,
  enqueueResearch,
  producerConnection,
} from "../queues/research.queue.js";
import { createRedis } from "../config/redis.js";
import {
  claimRun,
  checkRun,
  saveCheckpoint,
  failRun,
  recoverableRuns,
  markOrphanFailed,
} from "../services/research.service.js";
import { analyzeEvidence } from "../services/evidence.service.js";
import {
  createReportLayout,
  verifyFindings,
} from "../services/report.service.js";
import { runPipeline } from "../pipeline/run.js";
import {
  RunStopped,
  PermanentError,
  publicError,
  retryable,
  modelValidationDetails,
} from "../lib/errors.js";
import { client as database } from "../db/index.js";
import { createResearchPlan } from "../pipeline/planner.pipeline.js";
import { searchForSources } from "../pipeline/search.pipeline.js";

const connection = createRedis(true);
configureProviderScheduler(
  "openrouter",
  new ProviderScheduler(
    new RedisProviderGate(
      producerConnection,
      `openrouter:${process.env.OPENROUTER_RATE_LIMIT_GROUP || "default"}:
      ${process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning"}`,
      openRouterTokensPerMinute,
      openRouterRequestsPerMinute,
    ),
  ),
);
configureProviderScheduler(
  "exa",
  new ProviderScheduler(
    new RedisProviderGate(producerConnection, "exa:default"),
  ),
);

export const researchWorker = new Worker(
  RESEARCH_QUEUE,
  async (job, _lockToken, lockSignal) => {
    const claimed = await claimRun(job.data.projectId);

    if (!claimed) {
      return;
    }

    const { project, token } = claimed;

    return workerLogging.run(
      {
        id: project.id,
        question: project.question,
        startedAt: project.startedAt!,
      },
      async () => {
        console.log(
          `Research attempt ${job.attemptsMade + 1}: ${project.question}`,
        );

        const controller = new AbortController();
        const signal = lockSignal
          ? AbortSignal.any([controller.signal, lockSignal])
          : controller.signal;
        const deadline = setTimeout(
          () => controller.abort(new PermanentError(researchTimeBudgetMessage)),
          Math.max(
            0,
            researchTimeBudgetMs - (Date.now() - project.startedAt!.getTime()),
          ),
        );
        let stage = project.status;
        let checking = false;

        const timer = setInterval(async () => {
          if (checking) {
            return;
          }

          checking = true;

          try {
            await checkRun(project.id, token);
          } catch {
            controller.abort();
          } finally {
            checking = false;
          }
        }, 2000);

        try {
          return await runPipeline(
            { ...project, startedAt: project.startedAt! },
            {
              check: () => {
                signal.throwIfAborted();

                return checkRun(project.id, token);
              },
              save: (state, status, progress, report) => {
                signal.throwIfAborted();

                stage = status;

                return saveCheckpoint(
                  project.id,
                  token,
                  state,
                  status,
                  progress,
                  report,
                );
              },
              plan: (question, depth, scope, signal, checkpoint) =>
                createResearchPlan(
                  question,
                  depth,
                  scope,
                  signal,
                  checkpoint,
                ),
              search: (searches, question, plan, scope, signal, checkpoint) =>
                searchForSources(
                  searches,
                  question,
                  plan,
                  scope,
                  signal,
                  checkpoint,
                  {
                    search: (query, scope, signal) =>
                      queuedSearch(
                        query,
                        scope,
                        signal,
                        project.id,
                        plan.plannedQueries?.find((q) => q.query === query)
                          ?.id ?? `Q${plan.queries.indexOf(query) + 1}`,
                      ),
                    review: async () => {
                      throw new Error("Unused");
                    },
                  },
                ),
              analyze: analyzeEvidence,
              reviewSearch,
              extractRecords: extractEvidenceRecords,
              synthesize: synthesizeEvidence,

              verify: (question, analysis, sources, signal) =>
                verifyFindings(
                  `${question} (Research as of ${project.checkpoint.plan?.brief?.currentDate ??
                    new Date().toISOString().slice(0, 10)}; scheduled releases are not available results.)`,
                  analysis,
                  sources,
                  signal,
                ),
              present: createReportLayout,
            },
            signal,
          );
        } catch (error) {
          deferLostLock(lockSignal);

          if (
            controller.signal.aborted &&
            controller.signal.reason instanceof PermanentError
          ) {
            await failRun(
              project.id,
              token,
              controller.signal.reason.message,
              true,
            );

            throw new UnrecoverableError(controller.signal.reason.message);
          }

          if (error instanceof RunStopped || controller.signal.aborted) {
            await checkRun(project.id, token);

            throw error;
          }

          console.error(
            JSON.stringify({
              event: "provider_failure",
              stage,
              provider: (error as { provider?: string }).provider,
              retryAfterMs: (error as { retryAfterMs?: number }).retryAfterMs,
              projectId: project.id,
              status: (error as { status?: number }).status,
              code: (error as { code?: string }).code,
              type: error instanceof Error ? error.name : "unknown",
              validation: modelValidationDetails(error),
              reason:
                error instanceof PermanentError ? error.message : undefined,
            }),
          );
          const final =
            !retryable(error) ||
            job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
          await failRun(project.id, token, publicError(error), final);

          if (final) {
            throw new UnrecoverableError(publicError(error));
          }

          throw error;
        } finally {
          clearInterval(timer);
          clearTimeout(deadline);
        }
      },
    );
  },
  {
    connection,
    concurrency: researchWorkerConcurrency,
    lockDuration: researchLockDurationMs,
    lockRenewTime: 15000,
    maxStalledCount: 1,
    settings: { backoffStrategy: providerBackoff },
  },
);

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();
researchWorker.on("lockRenewalFailed", (jobIds) => {
  cancelLostLocks(researchWorker, jobIds);

  console.error(
    JSON.stringify({
      event: "research_lock_lost",
      jobIds,
      redisStatus: connection.status,
      lockDurationMs: researchLockDurationMs,
      eventLoopMaxDelayMs: Math.round(eventLoopDelay.max / 1e6),
      recovery:
        "Abort current work and resume checkpoint through stalled-job recovery",
      at: new Date().toISOString(),
    }),
  );
  eventLoopDelay.reset();
});

researchWorker.on("stalled", (jobId) => {
  console.warn(
    JSON.stringify({
      event: "research_job_stalled",
      jobId,
      at: new Date().toISOString(),
    }),
  );
});

researchWorker.on("error", (error) => {
  const details = error as Error & {
    code?: string;
    syscall?: string;
    errors?: Array<{ code?: string; syscall?: string }>;
  };
  // Worker errors also include lock failures; do not label every error a connection failure.
  let message = error.message.replace(/rediss?:\/\/[^\s]+/g, "[Redis URL]");

  for (const secret of [process.env.REDIS_PASSWORD, process.env.REDIS_URL]) {
    if (secret) {
      message = message.split(secret).join("[redacted]");
    }
  }

  console.error(
    JSON.stringify({
      event: "research_worker_error",
      type: error.name,
      code: details.code,
      syscall: details.syscall,
      message: message.slice(0, 500),
      redisStatus: connection.status,
      causes: details.errors?.map(({ code, syscall }) => ({ code, syscall })),
    }),
  );
});

researchWorker.on("failed", (job) => {
  const id = job?.data.projectId;
  workerLogging.event(id, () =>
    console.error(
      JSON.stringify({
        event: "research_attempt_failed",
        projectId: id,
        attempt: job?.attemptsMade,
      }),
    ),
  );

  if (id) {
    workerLogging.release(id);
  }
});

researchWorker.on("completed", (job, result) => {
  const id = job.data.projectId;
  workerLogging.event(id, () =>
    console.log(
      JSON.stringify({
        event: result?.awaitingApproval
          ? "research_plan_ready"
          : "research_completed",
        projectId: id,
      }),
    ),
  );

  workerLogging.release(id);
});

let reconciling = false;

export async function reconcile() {
  if (reconciling) {
    return;
  }

  reconciling = true;

  let step = "load recoverable runs";

  try {
    for (const row of await recoverableRuns()) {
      if (
        row.startedAt &&
        Date.now() - row.startedAt.getTime() > researchTimeBudgetMs
      ) {
        step = "mark expired run";
        await markOrphanFailed(row.id, researchTimeBudgetMessage);

        continue;
      }

      step = "get queued job";
      const job = await researchQueue.getJob(
        row.checkpoint.planApproved ? `${row.id}-approved` : row.id,
      );

      if (!job) {
        step = "enqueue missing job";
        await enqueueResearch(row.id, row.checkpoint.planApproved);

        continue;
      }

      step = "get job state";
      const state = await job.getState();

      if (state === "failed" || state === "completed") {
        step = "mark orphaned run";
        await markOrphanFailed(
          row.id,
          "The worker stopped before completing this research. Start a new run.",
        );
      }

      step = "load recoverable runs";
    }
  } catch (error) {
    const details = error as {
      code?: string;
      name?: string;
      cause?: { code?: string; syscall?: string };
      errors?: Array<{ code?: string }>;
    };

    console.error(
      JSON.stringify({
        event: "research_reconciliation_delayed",
        step,
        type: details?.name ?? "unknown",
        code: details?.code,
        causeCode: details?.cause?.code,
        causeSyscall: details?.cause?.syscall,
        causes: details?.errors?.map(({ code }) => ({ code })),
        redisStatus: producerConnection.status,
      }),
    );
  } finally {
    reconciling = false;
  }
}

const recovery = setInterval(() => void reconcile(), 15000);
void reconcile();

export async function shutdown() {
  clearInterval(recovery);
  eventLoopDelay.disable();
  await researchWorker.close();
  await closeSearchQueue();
  await researchQueue.close();
  await connection.quit();
  await producerConnection.quit();
  await database.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
