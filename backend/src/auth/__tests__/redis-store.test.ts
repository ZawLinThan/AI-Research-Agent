import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import IORedis from "ioredis";
import { RedisProviderGate } from "../../lib/providerRateLimit.js";
import { RedisAuthStore } from "../store.js";

test("Redis session operations enforce expiry, exclusive locks, conditional refresh and single-use state", async (t) => {
  if (spawnSync("redis-server", ["--version"]).error) {
    t.skip("redis-server is not installed");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "fieldwork-auth-test-"));
  const socket = join(dir, "redis.sock");
  const child = spawn(
    "redis-server",
    [
      "--port",
      "0",
      "--unixsocket",
      socket,
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      dir,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let redis: IORedis | undefined;
  t.after(async () => {
    redis?.disconnect();
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGTERM");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Temporary Redis did not start")),
      5000,
    );
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Temporary Redis exited before startup"));
    });
    child.stdout.on("data", (chunk) => {
      if (String(chunk).toLowerCase().includes("ready to accept connections")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  redis = new IORedis(socket, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await redis.connect();
  // Independent limiter instances share atomic admission through Redis.
  const firstGate = new RedisProviderGate(redis, "test-openrouter", 8000, 30);
  const secondGate = new RedisProviderGate(redis, "test-openrouter", 8000, 30);
  const admissions = await Promise.all([
    firstGate.acquire(5000),
    secondGate.acquire(5000),
  ]);
  assert.equal(admissions.filter((n) => n === 0).length, 1);
  assert.ok(admissions.some((n) => n > 0));
  await firstGate.cooldown(90000);
  await secondGate.cooldown(1000); // A shorter cooldown cannot overwrite the longer one.
  assert.ok((await secondGate.acquire(1)) > 80000);
  await assert.rejects(firstGate.acquire(8001), /token-per-minute/);
  const rpmGate = new RedisProviderGate(redis, "test-rpm", 8000, 1);
  assert.equal(await rpmGate.acquire(0), 0);
  assert.ok((await rpmGate.acquire(0)) > 0);
  const store = new RedisAuthStore(redis);
  await store.put("session", "original", 60);
  assert.ok((await redis.ttl("session")) > 0);
  assert.equal(await store.replace("session", "wrong", "refreshed", 60), false);
  assert.equal(
    await store.replace("session", "original", "refreshed", 60),
    true,
  );
  assert.equal(await store.get("session"), "refreshed");
  assert.equal(await store.take("session"), "refreshed");
  assert.equal(await store.take("session"), null);
  assert.equal(
    await store.replace("session", "refreshed", "resurrected", 60),
    false,
  );
  assert.equal(await store.acquire("lock", "owner", 30), true);
  assert.equal(await store.acquire("lock", "other", 30), false);
  await store.release("lock", "other");
  assert.equal(await store.get("lock"), "owner");
  await store.release("lock", "owner");
  assert.equal(await store.get("lock"), null);
  assert.equal(await store.increment("rate", 600), 1);
  assert.equal(await store.increment("rate", 600), 2);
  assert.ok((await redis.ttl("rate")) > 0);
});
