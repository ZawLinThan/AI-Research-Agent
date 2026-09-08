import { eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { researchProjects } from "../db/schema.js";

export const createResearchProject = async (question: string) => {
  const [project] = await db
    .insert(researchProjects)
    .values({
      question,
      status: "pending",
    })
    .returning();

  return project;
};

export const updateResearchStatus = async (
  projectId: string,
  status: string,
) => {
  await db
    .update(researchProjects)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(researchProjects.id, projectId));
};
