import { beforeProviderCall } from "../lib/providerCalls.js";
import { createHash } from "node:crypto";
import { Queue, QueueEvents, Worker } from "bullmq";
import { createRedis } from "../config/redis.js";
import { search } from "../services/search.service.js";
import type { Source } from "../types/research.js";
const name = `${process.env.RESEARCH_QUEUE_NAME || "research-v2"}-search`;
const connection = createRedis();
export const searchQueue = new Queue(name, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});
const eventConnection = createRedis(true);
const workerConnection = createRedis(true);
const events = new QueueEvents(name, { connection: eventConnection });
export const searchWorker = new Worker(
  name,
  async (job) => {
    const signal = AbortSignal.timeout(60000);
    const results = await search(job.data.query, job.data.scope, signal);
    return results.map((s) => ({ ...s, queryIds: [job.data.queryId] }));
  },
  { connection: workerConnection, concurrency: 3 },
);
export async function queuedSearch(
  query: string,
  scope: string,
  signal: AbortSignal,
  runId: string,
  queryId: string,
): Promise<Source[]> {
  signal.throwIfAborted();
  await beforeProviderCall();
  const jobId = createHash("sha256")
    .update(JSON.stringify([runId, queryId, query, scope]))
    .digest("hex");
  const job = await searchQueue.add(
    "query",
    { query, scope, runId, queryId },
    { jobId },
  );
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("Search cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([job.waitUntilFinished(events, 180000), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
export async function closeSearchQueue() {
  await searchWorker.close();
  await events.close();
  await searchQueue.close();
  await Promise.all([
    connection.quit(),
    eventConnection.quit(),
    workerConnection.quit(),
  ]);
}
