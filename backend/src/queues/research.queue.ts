import { Queue } from "bullmq";
import { redisConnection } from "../config/redis.js";

export const RESEARCH_QUEUE = "research";

export const researchQueue = new Queue(RESEARCH_QUEUE, {
  connection: redisConnection,
});
