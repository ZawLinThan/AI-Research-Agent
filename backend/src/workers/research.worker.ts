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
import { analyzeEvidence, sourceId } from "../services/evidence.service.js";
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
      `openrouter:${process.env.OPENROUTER_RATE_LIMIT_GROUP || "default"}:${process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning"}`,
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
  async (job) => {
    const claimed = await claimRun(job.data.projectId);

    if (!claimed) return;

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
        const deadline = setTimeout(
          () =>
            controller.abort(
              new PermanentError(
                "Research exceeded its thirty-minute time budget.",
              ),
            ),
          Math.max(0, 30 * 60000 - (Date.now() - project.startedAt!.getTime())),
        );
        let stage = project.status;
        let checking = false;

        const timer = setInterval(async () => {
          if (checking) return;
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
              check: () => checkRun(project.id, token),
              save: (state, status, progress, report) => {
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
              plan: createResearchPlan,
              search: searchForSources,
              analyze: analyzeEvidence,
              verify: verifyFindings,
              present: createReportLayout,
            },
            controller.signal,
          );
        } catch (error) {
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
          const final = !retryable(error) || job.attemptsMade + 1 >= 3;
          await failRun(project.id, token, publicError(error), final);
          if (final) throw new UnrecoverableError(publicError(error));
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
    maxStalledCount: 1,
    settings: { backoffStrategy: providerBackoff },
  },
);
researchWorker.on("error", (error) => {
  const details = error as Error & {
    code?: string;
    syscall?: string;
    errors?: Array<{ code?: string; syscall?: string }>;
  };
  // Worker errors also include lock failures; do not label every error a connection failure.
  let message = error.message.replace(/rediss?:\/\/[^\s]+/g, "[Redis URL]");
  for (const secret of [process.env.REDIS_PASSWORD, process.env.REDIS_URL]) {
    if (secret) message = message.split(secret).join("[redacted]");
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
  if (id) workerLogging.release(id);
});
researchWorker.on("completed", (job) => {
  const id = job.data.projectId;
  workerLogging.event(id, () =>
    console.log(JSON.stringify({ event: "research_completed", projectId: id })),
  );
  workerLogging.release(id);
});
let reconciling = false;
export async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    for (const row of await recoverableRuns()) {
      if (row.startedAt && Date.now() - row.startedAt.getTime() > 15 * 60_000) {
        await markOrphanFailed(
          row.id,
          "Research exceeded its fifteen-minute time budget.",
        );
        continue;
      }
      const job = await researchQueue.getJob(row.id);
      if (!job) {
        await enqueueResearch(row.id);
        continue;
      }
      const state = await job.getState();
      if (state === "failed" || state === "completed")
        await markOrphanFailed(
          row.id,
          "The worker stopped before completing this research. Start a new run.",
        );
    }
  } catch {
    console.error(
      "Research reconciliation delayed; database or Redis unavailable",
    );
  } finally {
    reconciling = false;
  }
}
const recovery = setInterval(() => void reconcile(), 15000);
void reconcile();
export async function shutdown() {
  clearInterval(recovery);
  await researchWorker.close();
  await researchQueue.close();
  await connection.quit();
  await producerConnection.quit();
  await database.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
