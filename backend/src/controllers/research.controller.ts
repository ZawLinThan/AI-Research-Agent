import type { Request, Response } from "express";
import { z } from "zod";
import {
  createResearchProject,
  listResearch,
  getResearch,
  cancelResearch,
} from "../services/research.service.js";
import { enqueueResearch } from "../queues/research.queue.js";
import { requestSchema } from "../zodSchema/research.schema.js";

export async function createResearch(req: Request, res: Response) {
  const input = requestSchema.parse(req.body);

  const project = await createResearchProject(res.locals.ownerId, input);

  let queued = true;
  try {
    if (!["completed", "failed", "cancelled"].includes(project.status))
      await enqueueResearch(project.id);
  } catch {
    queued = false;
  }
  res
    .status(202)
    .json({ projectId: project.id, status: project.status, queued });
}
export async function getResearchStatus(req: Request, res: Response) {
  res.json(
    await getResearch(
      z.string().uuid().parse(req.params.projectId),
      res.locals.ownerId,
    ),
  );
}

export async function listResearchProjects(_req: Request, res: Response) {
  res.json({ projects: await listResearch(res.locals.ownerId) });
}
export async function cancelResearchProject(req: Request, res: Response) {
  res.json(
    await cancelResearch(
      z.string().uuid().parse(req.params.projectId),
      res.locals.ownerId,
    ),
  );
}
