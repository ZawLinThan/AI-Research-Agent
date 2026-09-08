import { Worker } from "bullmq";

import { RESEARCH_QUEUE } from "../queues/research.queue.js";

import { redisConnection } from "../config/redis.js";
import { updateResearchStatus } from "../services/research.service.js";

export const researchWorker = new Worker(
  RESEARCH_QUEUE,

  async (job) => {
    const { projectId, question } = job.data;

    await updateResearchStatus(projectId, "planning");

    // later:
    // create research plan

    await updateResearchStatus(projectId, "searching");

    // later:
    // search web

    await updateResearchStatus(projectId, "analyzing");

    // later:
    // extract evidence

    await updateResearchStatus(projectId, "generating_report");

    // later:
    // write report

    await updateResearchStatus(projectId, "completed");
  },

  {
    connection: redisConnection,
  },
);
