/** One-time repair for the pre-existing research schema whose migration files were regenerated. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { client } from "../src/db/index.js";
async function main() {
  await client.begin(async (sql) => {
    const columns =
      await sql`select column_name,data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='research_projects'`;
    const expected: Record<string, string> = {
      id: "uuid",
      question: "text",
      status: "text",
      report: "text",
      error: "text",
      created_at: "timestamp without time zone",
      updated_at: "timestamp without time zone",
      research_plan: "jsonb",
    };
    if (
      columns.length !== 8 ||
      !columns.every((c) => expected[c.column_name] === c.data_type)
    )
      throw new Error(
        "Schema differs from the known baseline; no changes made.",
      );
    const journal = JSON.parse(
      readFileSync("backend/drizzle/meta/_journal.json", "utf8"),
    );
    for (const entry of journal.entries.slice(0, 2)) {
      const hash = createHash("sha256")
        .update(readFileSync(`backend/drizzle/${entry.tag}.sql`))
        .digest("hex");
      await sql`insert into drizzle.__drizzle_migrations (hash,created_at) select ${hash},${entry.when} where not exists(select 1 from drizzle.__drizzle_migrations where hash=${hash})`;
    }
  });
  console.log(
    "Verified existing eight-column schema; recorded matching baseline migrations.",
  );
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
