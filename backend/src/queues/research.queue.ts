import { Queue } from "bullmq";
import { createRedis } from "../config/redis.js";
export const RESEARCH_QUEUE = process.env.RESEARCH_QUEUE_NAME || "research-v2";

export const producerConnection = createRedis();

export const researchQueue = new Queue(RESEARCH_QUEUE, {
  connection: producerConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "provider" },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 1000 },
  },
});

export async function enqueueResearch(id: string) {
  return researchQueue.add("run", { projectId: id }, { jobId: id });
}
