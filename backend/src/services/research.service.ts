import { and, desc, eq, gte, isNotNull, notInArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  researchProjects as projects,
  researchSources as sources,
} from "../db/schema.js";
import type {
  Checkpoint,
  ResearchInput,
  ResearchStatus,
} from "../../../shared/research.js";
import { RunStopped } from "../lib/errors.js";

export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const owned = (id: string, owner: string) =>
  and(eq(projects.id, id), eq(projects.ownerId, owner));

const active = notInArray(projects.status, [
  "completed",
  "failed",
  "cancelled",
]);

export async function createResearchProject(
  owner: string,
  input: ResearchInput,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner}))`);
    const [existing] = await tx
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.ownerId, owner),
          eq(projects.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (existing) {
      if (
        existing.question !== input.question ||
        existing.depth !== input.depth ||
        existing.scope !== input.scope
      )
        throw new RequestError(
          409,
          "This request ID was already used for a different question.",
        );
      return existing;
    }
    const [{ count: running }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.ownerId, owner), active));
    if (running >= 3)
      throw new RequestError(
        429,
        "You already have three active research runs. Wait or cancel one.",
      );
    const [{ count: daily }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(
        and(
          eq(projects.ownerId, owner),
          gte(projects.createdAt, new Date(Date.now() - 86400_000)),
        ),
      );
    if (daily >= 20)
      throw new RequestError(
        429,
        "Daily research limit reached. Please try again tomorrow.",
      );
    const [project] = await tx
      .insert(projects)
      .values({
        ownerId: owner,
        requestId: input.requestId,
        question: input.question,
        depth: input.depth,
        scope: input.scope,
      })
      .returning();
    return project;
  });
}

export async function listResearch(owner: string) {
  return db
    .select({
      id: projects.id,
      question: projects.question,
      status: projects.status,
      depth: projects.depth,
      scope: projects.scope,
      progress: projects.progress,
      error: projects.error,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.ownerId, owner))
    .orderBy(desc(projects.createdAt))
    .limit(100);
}
export async function getResearch(id: string, owner: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(owned(id, owner))
    .limit(1);
  if (!project) throw new RequestError(404, "Research not found.");
  const rows = await db.select().from(sources).where(eq(sources.projectId, id));
  const { checkpoint, runToken, ownerId, requestId, startedAt, ...visible } =
    project;
  return { ...visible, sources: rows };
}
export async function cancelResearch(id: string, owner: string) {
  await db
    .update(projects)
    .set({ status: "cancelled", updatedAt: new Date(), runToken: null })
    .where(and(owned(id, owner), active));
  return getResearch(id, owner);
}
export async function claimRun(id: string) {
  const token = randomUUID();
  const [project] = await db
    .update(projects)
    .set({
      runToken: token,
      startedAt: sql`coalesce(${projects.startedAt}, now())`,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), isNotNull(projects.ownerId), active))
    .returning();
  return project ? { project, token } : null;
}
export async function checkRun(id: string, token: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.runToken, token), active))
    .limit(1);
  if (!row) throw new RunStopped("Run cancelled or superseded");
}
export async function saveCheckpoint(
  id: string,
  token: string,
  state: Checkpoint,
  status: ResearchStatus,
  progress: number,
  report?: string,
) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(projects)
      .set({
        checkpoint: state,
        researchPlan: state.plan,
        status,
        progress,
        report,
        error: null,
        updatedAt: new Date(),
      })
      .where(and(eq(projects.id, id), eq(projects.runToken, token), active))
      .returning({ id: projects.id });
    if (!rows.length) throw new RunStopped("Run cancelled or superseded");
    if (state.sources) {
      await tx.delete(sources).where(eq(sources.projectId, id));
      if (state.sources.length)
        await tx.insert(sources).values(
          state.sources.map((s) => ({
            ...s,
            projectId: id,
            retrievedAt: new Date(s.retrievedAt),
          })),
        );
    }
  });
}
export async function failRun(
  id: string,
  token: string,
  message: string,
  final: boolean,
) {
  await db
    .update(projects)
    .set({
      status: final ? "failed" : "pending",
      error: message,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.runToken, token), active));
}
export async function recoverableRuns() {
  return db
    .select({ id: projects.id, startedAt: projects.startedAt })
    .from(projects)
    .where(and(active, isNotNull(projects.ownerId)))
    .orderBy(projects.updatedAt)
    .limit(100);
}
export async function markOrphanFailed(id: string, message: string) {
  await db
    .update(projects)
    .set({
      status: "failed",
      runToken: null,
      error: message,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), active));
}
