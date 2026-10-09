import type { Request, Response } from "express";
import { z } from "zod";
import {
  createResearchProject,
  approveResearchPlan,
  listResearch,
  getResearch,
  cancelResearch,
} from "../services/research.service.js";
import { enqueueResearch } from "../queues/research.queue.js";
import { requestSchema, planSchema } from "../zodSchema/research.schema.js";

export async function createResearch(req: Request, res: Response) {
  const input = requestSchema.parse(req.body);

  const project = await createResearchProject(res.locals.ownerId, input);

  let queued = true;
  try {
    if (!["completed", "failed", "cancelled", "awaiting_approval"].includes(project.status))
      await enqueueResearch(project.id, project.checkpoint.planApproved);
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

export async function approvePlan(req: Request, res: Response) {
  const id = z.string().uuid().parse(req.params.projectId);
  const plan = planSchema.parse(req.body);
  plan.queries = [...new Set(plan.queries)];
  const project = await approveResearchPlan(id, res.locals.ownerId, plan);
  let queued = true;
  try { await enqueueResearch(id, true); } catch { queued = false; }
  res.status(202).json({ ...project, queued });
}
