import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  Checkpoint,
  ResearchPlan,
  ResearchStatus,
} from "../../../shared/research.js";

export const researchProjects = pgTable(
  "research_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: uuid("owner_id"),
    requestId: uuid("request_id"),
    question: text("question").notNull(),
    status: text("status").$type<ResearchStatus>().notNull().default("pending"),
    depth: text("depth").notNull().default("Deep research"),
    scope: text("scope").notNull().default("Web & academic"),
    progress: integer("progress").notNull().default(0),
    researchPlan: jsonb("research_plan").$type<ResearchPlan>(),
    checkpoint: jsonb("checkpoint").$type<Checkpoint>().notNull().default({}),
    runToken: uuid("run_token"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    report: text("report"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("research_owner_created_idx").on(t.ownerId, t.createdAt),
    uniqueIndex("research_owner_request_idx").on(t.ownerId, t.requestId),
    index("research_status_updated_idx").on(t.status, t.updatedAt),
  ],
);

export const researchSources = pgTable(
  "research_sources",
  {
    id: text("id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => researchProjects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title").notNull(),
    queryIds: jsonb("query_ids").$type<string[]>().notNull().default([]),
    publishedAt: text("published_at"),
    sourceDomain: text("source_domain"),
    highlights: jsonb("highlights").$type<string[]>().notNull(),
    queries: jsonb("queries").$type<string[]>().notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("research_source_project_url_idx").on(t.projectId, t.url),
    uniqueIndex("research_source_project_id_idx").on(t.projectId, t.id),
  ],
);
export const researchStages = pgTable("research_stages", {
  projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.projectId, t.stage] })]);
