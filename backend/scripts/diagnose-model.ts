import { db, client } from "../src/db/index.js";
import { researchProjects } from "../src/db/schema.js";
import { eq } from "drizzle-orm";
import { analyzeEvidence } from "../src/services/evidence.service.js";
import {
  verifyFindings,
  renderReport,
} from "../src/services/report.service.js";
import { retryable } from "../src/lib/errors.js";

async function attempt<T>(stage: string, action: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await action();
    } catch (error: any) {
      const raw = error.error?.failed_generation;
      console.log(
        JSON.stringify({
          stage,
          attempt: i + 1,
          status: error.status,
          code: error.code,
          type: error.name,
          failedLength: raw?.length,
          failedEndsWithBrace: raw?.trim().endsWith("}"),
        }),
      );
      if (!retryable(error) || i === 2)
        throw new Error(`${stage} failed after ${i + 1} attempts`);
      await new Promise((resolve) => setTimeout(resolve, 30000));
    }
  }
  throw new Error("Retry limit");
}
async function main() {
  try {
    const projectId = process.argv[2];
    if (
      !projectId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        projectId,
      )
    )
      throw new Error(
        "Supply the UUID of a run authorized for replay to OpenRouter.",
      );
    const [row] = await db
      .select({
        question: researchProjects.question,
        checkpoint: researchProjects.checkpoint,
      })
      .from(researchProjects)
      .where(eq(researchProjects.id, projectId));
    if (!row?.checkpoint.sources?.length)
      throw new Error("Saved evidence not found");
    const sources = row.checkpoint.sources;
    console.log(JSON.stringify({ stage: "loaded", sources: sources.length }));
    const analysis = await attempt("analysis", () =>
      analyzeEvidence(row.question, sources),
    );
    console.log(
      JSON.stringify({
        stage: "analyzed",
        groundedFindings: analysis.findings.length,
      }),
    );
    const verified = await attempt("verification", () =>
      verifyFindings(row.question, analysis, sources),
    );
    if (!verified.findings.length)
      throw new Error("No findings passed verification");
    const report = renderReport(row.question, verified, sources);
    console.log(
      JSON.stringify({
        stage: "verified",
        findings: verified.findings.length,
        reportCharacters: report.length,
        databaseChanged: false,
      }),
    );
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
