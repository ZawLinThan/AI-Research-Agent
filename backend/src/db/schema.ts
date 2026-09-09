import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const researchProjects = pgTable("research_projects", {
  id: uuid("id").defaultRandom().primaryKey(),

  question: text("question").notNull(),

  status: text("status").notNull().default("pending"),

  researchPlan: jsonb("research_plan"),

  report: text("report"),

  error: text("error"),

  createdAt: timestamp("created_at").defaultNow().notNull(),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
