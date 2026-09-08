import type { Request, Response } from "express";

import { db } from "../db/index.js";
import { researchProjects } from "../db/schema.js";
import { researchQueue } from "../queues/research.queue.js";
import { eq } from "drizzle-orm";

export async function createResearch(req: Request, res: Response) {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        error: "Question is required",
      });
    }

    const [project] = await db
      .insert(researchProjects)
      .values({
        question,
        status: "pending",
      })
      .returning();

    await researchQueue.add("start-research", {
      projectId: project.id,
      question,
    });

    return res.status(202).json({
      projectId: project.id,
      status: project.status,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to create research",
    });
  }
}

export const getResearchStatus = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    const project = await db
      .select()
      .from(researchProjects)
      .where(eq(researchProjects.id, projectId as string))
      .limit(1);

    if (!project || project.length === 0) {
      return res.status(404).json({
        error: "Research project not found",
      });
    }

    return res.status(200).json(project[0]);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to get research status",
    });
  }
};
