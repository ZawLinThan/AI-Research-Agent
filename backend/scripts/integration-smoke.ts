import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
// Synthetic server-side sessions apply only to this test; no Supabase accounts are created.
async function main() {
  process.env.RESEARCH_QUEUE_NAME = "integration-" + randomUUID();
  const owner = randomUUID(),
    other = randomUUID();
  const a = randomBytes(32).toString("hex"),
    b = randomBytes(32).toString("hex");
  const { app } = await import("../src/app.js");
  const { researchQueue, producerConnection } =
    await import("../src/queues/research.queue.js");
  const { authSessions } = await import("../src/auth/index.js");
  const sessionKeys: string[] = [];
  for (const [id, userId] of [
    [a, owner],
    [b, other],
  ]) {
    const key = "auth:session:" + createHash("sha256").update(id).digest("hex");
    sessionKeys.push(key);
    await authSessions.store.put(
      key,
      JSON.stringify({
        access_token: "synthetic-test-only",
        refresh_token: "synthetic-test-only",
        expires_in: 900,
        expiresAt: Date.now() + 900000,
        deadline: Date.now() + 900000,
        user: { id: userId, email: "integration@example.invalid" },
      }),
      900,
    );
  }
  const { client } = await import("../src/db/index.js");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve()),
  );
  const address = server.address() as { port: number };
  const api = async (
    path: string,
    method = "GET",
    body?: unknown,
    auth = a,
  ) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/research${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: new URL(
            process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5173",
          ).origin,
          "X-CSRF-Protection": "1",
          ...(auth ? { Cookie: `${authSessions.cookieName}=${auth}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: response.status, body: await response.json() };
  };
  let stop: (() => Promise<void>) | undefined;
  try {
    assert.equal((await api("", "GET", undefined, "")).status, 401);
    assert.equal(
      (await api("", "POST", { question: "short", requestId: randomUUID() }))
        .status,
      400,
    );
    const request = {
      question: "What guarantees does BullMQ provide for retrying failed jobs?",
      depth: "Quick overview",
      scope: "Web",
      requestId: randomUUID(),
    };
    const first = await api("", "POST", request);
    assert.equal(first.status, 202);
    const id = first.body.projectId;
    assert.equal((await api("", "POST", request)).body.projectId, id);
    assert.equal((await api("/" + id, "GET", undefined, b)).status, 404);
    assert.equal(
      (await api("/" + id + "/cancel", "POST", undefined, b)).status,
      404,
    );
    assert.equal((await api("", "GET", undefined, b)).body.projects.length, 0);
    const cancelled = await api("/" + id + "/cancel", "POST");
    assert.equal(cancelled.body.status, "cancelled");
    const claim = await import("../src/services/research.service.js");
    assert.equal(await claim.claimRun(id), null);
    console.log(
      "PASS authentication, ownership isolation, duplicate submission, cancellation",
    );
    // Check actual RLS using a non-owner auth role and local JWT claims.
    await client.begin(async (sql) => {
      await sql`set local role authenticated`;
      await sql`select set_config('request.jwt.claim.sub',${other},true)`;
      const rows = await sql`select id from research_projects where id=${id}`;
      assert.equal(rows.length, 0);
    });
    console.log("PASS database row-level ownership policy");
    const live = await api("", "POST", { ...request, requestId: randomUUID() });
    assert.equal(live.status, 202);
    const worker = await import("../src/workers/research.worker.js");
    stop = worker.shutdown;
    let last = "";
    const until = Date.now() + 7 * 60_000;
    while (Date.now() < until) {
      const result = await api("/" + live.body.projectId);
      assert.equal(result.status, 200);
      const p = result.body;
      if (p.status !== last) {
        console.log(JSON.stringify({ stage: p.status, progress: p.progress }));
        last = p.status;
      }
      if (p.status === "failed") throw new Error(p.error);
      if (p.status === "completed") {
        assert.ok(p.report?.includes("## Sources"));
        assert.ok(p.sources.length);
        const reread = await api("/" + p.id);
        assert.equal(reread.body.report, p.report);
        await writeFile("/tmp/fieldwork-live-report.md", p.report);
        console.log(
          JSON.stringify({
            verified: "Live API → queue → worker → Exa → Groq → Postgres → API",
            sources: p.sources.length,
            reportCharacters: p.report.length,
          }),
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    throw new Error("Live test exceeded its time limit");
  } finally {
    for (const key of sessionKeys) await authSessions.store.remove(key);
    // Test-owned rows and isolated queue only. No user records are touched.
    await researchQueue.obliterate({ force: true });
    await client`delete from research_projects where owner_id=${owner}`;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (stop) await stop();
    else {
      await researchQueue.close();
      await producerConnection.quit();
      await client.end();
    }
  }
}
main().catch((e) => {
  console.error("Integration check failed:", e.message);
  process.exitCode = 1;
});
