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
import { searchWithSignal } from "../services/search.service.js";
import { analyzeEvidence, sourceId } from "../services/evidence.service.js";
import { verifyFindings } from "../services/report.service.js";
import { runPipeline } from "../pipeline/run.js";
import { RunStopped, publicError, retryable } from "../lib/errors.js";
import { client as database } from "../db/index.js";
import { createResearchPlan } from "../pipeline/planner.pipeline.js";

const connection = createRedis(true);

export const researchWorker = new Worker(
  RESEARCH_QUEUE,
  async (job) => {
    const claimed = await claimRun(job.data.projectId);

    if (!claimed) return;

    const { project, token } = claimed;
    const controller = new AbortController();
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
          search: async (query, scope, signal) => {
            const response = await searchWithSignal(query, scope, signal);
            return response.results.map((r) => ({
              id: sourceId(r.url),
              url: r.url,
              title: r.title || r.url,
              highlights: r.highlights || [],
              queries: [query],
              retrievedAt: new Date().toISOString(),
              logo: new URL(r.url).origin + "/favicon.ico",
            }));
          },
          analyze: analyzeEvidence,
          verify: verifyFindings,
        },
        controller.signal,
      );
    } catch (error) {
      if (error instanceof RunStopped || controller.signal.aborted) {
        await checkRun(project.id, token);
        throw error;
      }
      console.error(
        JSON.stringify({
          event: "provider_failure",
          stage,
          projectId: project.id,
          status: (error as { status?: number }).status,
          code: (error as { code?: string }).code,
          type: error instanceof Error ? error.name : "unknown",
        }),
      );
      const final = !retryable(error) || job.attemptsMade + 1 >= 3;
      await failRun(project.id, token, publicError(error), final);
      if (final) throw new UnrecoverableError(publicError(error));
      throw error;
    } finally {
      clearInterval(timer);
    }
  },
  { connection, concurrency: 2, maxStalledCount: 1 },
);
researchWorker.on("error", () =>
  console.error("Research worker connection error"),
);
researchWorker.on("failed", (job) =>
  console.error(
    JSON.stringify({
      event: "research_attempt_failed",
      projectId: job?.data.projectId,
      attempt: job?.attemptsMade,
    }),
  ),
);
let reconciling = false;
export async function reconcile() {
  if (reconciling) return;
  reconciling = true;
  try {
    for (const row of await recoverableRuns()) {
      if (row.startedAt && Date.now() - row.startedAt.getTime() > 8 * 60_000) {
        await markOrphanFailed(
          row.id,
          "Research exceeded its eight-minute time budget.",
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
