import { eq } from "drizzle-orm";
import { client } from "../config/groqAI.js";
import { db } from "../db/index.js";
import { researchProjects } from "../db/schema.js";
import { ResearchPlan } from "../types/index.js";

export const createResearchPlan = async (
  projectId: string,
  question: string,
) => {
  const prompt = `Create 3-6 web search queries to answer the following research question: "${question}". Respond with ONLY a raw JSON array of strings. 
No markdown, no code fences, no explanation.`;

  const response = await client.responses.create({
    model: "openai/gpt-oss-20b",
    input: prompt,
  });

  const researchPlan: ResearchPlan = JSON.parse(response.output_text);

  console.log("Research plan created:", researchPlan);

  await db
    .update(researchProjects)
    .set({
      researchPlan: researchPlan,
    })
    .where(eq(researchProjects.id, projectId));

  return researchPlan;
};
