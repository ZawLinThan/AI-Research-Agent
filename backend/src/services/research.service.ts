import { planIssues, reviewPlan } from "./planner.service.js";
import { and, desc, eq, gte, isNotNull, notInArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  researchProjects as projects,
  researchStages as stages,
  researchSources as sources,
} from "../db/schema.js";
import type {
  Checkpoint,
  ResearchInput,
  ResearchPlan,
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
  const stageRows = await db.select().from(stages).where(eq(stages.projectId, id));
  return { ...visible, sources: rows, stages: stageRows };
}
export async function cancelResearch(id: string, owner: string) {
  await db
    .update(projects)
    .set({ status: "cancelled", updatedAt: new Date(), runToken: null })
    .where(and(owned(id, owner), active));
  return getResearch(id, owner);
}
export async function approveResearchPlan(id: string, owner: string, plan: ResearchPlan) {
  const [existing] = await db.select().from(projects).where(owned(id, owner)).limit(1);
  if (!existing || existing.status !== "awaiting_approval") throw new RequestError(409, "This plan is no longer awaiting approval.");
  plan = { ...existing.researchPlan, queries: plan.queries,
    plannedQueries: plan.queries.map((query, i) => ({
      ...(existing.researchPlan?.plannedQueries?.find(q => q.query === query) ?? { informationNeed: query, entities: [] }),
      id: `Q${i+1}`, query,
    })) };
  const issues = planIssues(plan, existing.depth);
  if (issues.length) throw new RequestError(400, issues.join(" "));
  if (plan.brief?.answerShape === "comparison" || JSON.stringify(plan.queries) !== JSON.stringify(existing.researchPlan?.queries)) {
    const review = await reviewPlan(existing.question, plan);
    if (!review.valid) throw new RequestError(400, review.revisionInstructions.join(" ") || "Edited plan failed review.");
    plan.reviews = [...(plan.reviews ?? []), review];
  }
  const [updated] = await db.update(projects).set({
    researchPlan: plan,
    checkpoint: { ...existing.checkpoint, plan, planApproved: true },
    status: "pending",
    startedAt: null,
    runToken: null,
    error: null,
    updatedAt: new Date(),
  }).where(and(owned(id, owner), eq(projects.status, "awaiting_approval"))).returning({ id: projects.id });
  if (!updated) throw new RequestError(409, "This plan is no longer awaiting approval.");
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
    .where(and(eq(projects.id, id), isNotNull(projects.ownerId), active, notInArray(projects.status, ["awaiting_approval"])))
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
    const artifacts: Record<string, unknown> = {
      brief: (state.plan ?? state.planningDraft)?.brief, plan: state.plan ?? state.planningDraft, plan_review: (state.plan ?? state.planningDraft)?.reviews,
      search_results: state.searches, search_review: state.searchReview,
      evidence: state.evidenceRecords, report_claims: state.reportClaims, final_report: report,
    };
    for (const [stage, payload] of Object.entries(artifacts)) {
      if (payload === undefined) continue;
      await tx.insert(stages).values({ projectId: id, stage, payload }).onConflictDoUpdate({
        target: [stages.projectId, stages.stage], set: { payload, updatedAt: new Date() },
      });
    }
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
    .select({ id: projects.id, startedAt: projects.startedAt, checkpoint: projects.checkpoint })
    .from(projects)
    .where(and(active, isNotNull(projects.ownerId), notInArray(projects.status, ["awaiting_approval"])))
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
