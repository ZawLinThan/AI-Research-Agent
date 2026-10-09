import { cancelLostLocks, deferLostLock } from "../src/lib/workerLock.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
async function main() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r) => probe.close(() => r()));
  const dir = await mkdtemp(join(tmpdir(), "fieldwork-redis-"));
  const start = () =>
    spawn(
      "redis-server",
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(port),
        "--dir",
        dir,
        "--appendonly",
        "yes",
        "--appendfsync",
        "always",
        "--save",
        "",
      ],
      { stdio: "ignore" },
    );
  let redis = start();
  const connection = new IORedis({
    host: "127.0.0.1",
    port,
    maxRetriesPerRequest: null,
    retryStrategy: () => 100,
  });
  connection.on("error", () => {});
  await connection.ping();
  const queue = new Queue("resilience", { connection });
  let worker: Worker | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  const wait = async (check: () => Promise<boolean>) => {
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("Queue test timed out");
  };
  try {
    worker = new Worker(
      "resilience",
      async (job) => {
        if (job.attemptsMade === 0)
          throw new Error("temporary provider failure");
        return "retried";
      },
      { connection, stalledInterval: 1000 },
    );
    const retried = await queue.add(
      "retry",
      {},
      { attempts: 2, backoff: { type: "exponential", delay: 100 } },
    );
    await wait(async () => (await retried.getState()) === "completed");
    assert.equal((await queue.getJob(retried.id!))?.attemptsMade, 2);
    console.log("PASS BullMQ retries transient job failure");
    await worker.close();
    worker = undefined;
    child = spawn(
      process.execPath,
      [
        "-e",
        `const {Worker}=require('bullmq');const IORedis=require('ioredis');const c=new IORedis({port:${port},host:'127.0.0.1',maxRetriesPerRequest:null});new Worker('resilience',async()=>{await c.set('saved-stage','searched');await new Promise(()=>{});},{connection:c,lockDuration:1000,stalledInterval:1000});`,
      ],
      { cwd: process.cwd(), stdio: "ignore" },
    );
    const restarted = await queue.add("restart", {});
    await wait(
      async () => (await connection.get("saved-stage")) === "searched",
    );
    child.kill("SIGKILL");
    await once(child, "exit");
    child = undefined;
    worker = new Worker(
      "resilience",
      async () => {
        assert.equal(await connection.get("saved-stage"), "searched");
        return "resumed";
      },
      { connection, lockDuration: 1000, stalledInterval: 1000 },
    );
    await wait(async () => (await restarted.getState()) === "completed");
    console.log("PASS worker crash recovery with saved checkpoint");
    await worker.close();
    worker = undefined;
    let attempts = 0, aborted = false;
    const lockErrors: string[] = [];
    worker = new Worker("resilience", async (job, _token, signal) => {
      attempts++;
      if (attempts > 1) {
        assert.equal(await connection.get("lock-loss-checkpoint"), "searched");
        return "resumed after lock loss";
      }
      await connection.set("lock-loss-checkpoint", "searched");
      // Remove only this isolated test job's lease to reproduce renewal failure.
      await connection.del(`${queue.toKey(job.id!)}:lock`);
      try {
        await new Promise<void>((_, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
        });
      } catch {
        aborted = true;
        deferLostLock(signal);
        throw new Error("Lost-lock work must defer to stalled recovery");
      }
    }, { connection, lockDuration: 1000, lockRenewTime: 200, stalledInterval: 1000 });
    worker.on("lockRenewalFailed", ids => cancelLostLocks(worker!, ids));
    worker.on("error", error => lockErrors.push(error.message));
    const lost = await queue.add("lost-lock", {});
    await wait(async () => (await lost.getState()) === "completed");
    assert.ok(aborted);
    assert.equal(attempts, 2);
    assert.ok(!lockErrors.some(message => message.includes("moveToDelayed") || message.includes("moveToFinished")));
    console.log("PASS lock loss aborts stale work and resumes its checkpoint without invalid queue transitions");
    await worker.close();
    worker = undefined;
    const preserved = await queue.add("outage", {});
    redis.kill("SIGTERM");
    await once(redis, "exit");
    const producer = new IORedis({
      host: "127.0.0.1",
      port,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 300,
    });
    producer.on("error", () => {});
    await assert.rejects(producer.ping());
    producer.disconnect();
    console.log("PASS API Redis connection fails promptly during outage");
    redis = start();
    await wait(async () => {
      try {
        return (await connection.ping()) === "PONG";
      } catch {
        return false;
      }
    });
    assert.ok(await queue.getJob(preserved.id!));
    console.log("PASS persisted queue survives Redis restart");
  } finally {
    child?.kill("SIGKILL");
    if (worker) await worker.close(true);
    await queue.close();
    connection.disconnect();
    redis.kill("SIGTERM");
    await once(redis, "exit");
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
