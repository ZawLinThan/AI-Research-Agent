import { Worker } from "bullmq";

import { RESEARCH_QUEUE } from "../queues/research.queue.js";

import { redisConnection } from "../config/redis.js";
import { updateResearchStatus } from "../services/research.service.js";
import { client } from "../config/groqAI.js";
import { createResearchPlan } from "../services/planner.service.js";
import { ResearchPlan } from "../types/index.js";
import { searchWeb } from "../services/search.service.js";

export const researchWorker = new Worker(
  RESEARCH_QUEUE,

  async (job) => {
    const { projectId, question } = job.data;

    await updateResearchStatus(projectId, "planning");

    const researchPlan: ResearchPlan = await createResearchPlan(
      projectId,
      question,
    );
    // later:
    // create research plan

    await updateResearchStatus(projectId, "searching");
    await searchWeb(projectId, researchPlan);
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
