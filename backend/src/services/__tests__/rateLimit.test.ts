import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProviderScheduler,
  retryDelay,
  providerBackoff,
  abortableWait,
  tagProviderError,
  type ProviderGate,
} from "../../lib/providerRateLimit.js";
import { publicError } from "../../lib/errors.js";

const limited = (seconds: string) =>
  Object.assign(new Error("rate limited"), {
    status: 429,
    headers: new Headers({ "retry-after": seconds }),
  });
test("provider wait hints support seconds, dates, fractional reset durations and Axios headers", () => {
  assert.equal(retryDelay(limited("5")), 6000);
  const now = Date.UTC(2026, 8, 12);
  assert.equal(
    retryDelay(
      { headers: { "retry-after": new Date(now + 9000).toUTCString() } },
      now,
    ),
    10000,
  );
  assert.equal(
    retryDelay({ headers: { "x-ratelimit-reset-tokens": "1m7.66s" } }),
    68660,
  );
  assert.equal(
    retryDelay({ response: { headers: { "retry-after": "3" } } }),
    4000,
  );
  assert.equal(retryDelay({ headers: { "retry-after": "invalid" } }), 60000);
  assert.equal(providerBackoff(1, "provider", { retryAfterMs: 95000 }), 95000);
  assert.equal(providerBackoff(3, "provider", {}), 120000);
});
test("429 cooldown waits then retries only the provider request without failing the job", async () => {
  const waits: number[] = [],
    cooldowns: number[] = [];
  let calls = 0;
  const gate: ProviderGate = {
    acquire: async () => 0,
    cooldown: async (n) => {
      cooldowns.push(n);
    },
  };
  const scheduler = new ProviderScheduler(gate, async (n) => {
    waits.push(n);
  });
  const result = await scheduler.run(
    "openrouter",
    1000,
    undefined,
    async () => {
      if (++calls === 1) {
        throw limited("5");
      }

      return "completed";
    },
  );
  assert.equal(result, "completed");
  assert.equal(calls, 2);
  assert.deepEqual(waits, [6000]);
  assert.deepEqual(cooldowns, [6000]);
});
test("persistent throttling is bounded and retains provider and delay for queue backoff", async () => {
  let calls = 0;
  const scheduler = new ProviderScheduler(
    { acquire: async () => 0, cooldown: async () => {} },
    async () => {},
  );
  await assert.rejects(
    scheduler.run("exa", 0, undefined, async () => {
      calls++;
      throw limited("90");
    }),
    (error: any) => {
      assert.equal(error.provider, "exa");
      assert.equal(error.retryAfterMs, 91000);
      assert.match(publicError(error), /search provider.*rate-limiting/);
      return true;
    },
  );
  assert.equal(calls, 3);
});
test("cancellation stops pending admission without sending a request", async () => {
  const controller = new AbortController();
  let calls = 0;
  const scheduler = new ProviderScheduler(
    { acquire: async () => 60000, cooldown: async () => {} },
    async (_n, signal) => {
      controller.abort();
      signal!.throwIfAborted();
    },
  );
  await assert.rejects(
    scheduler.run("openrouter", 1000, controller.signal, async () => {
      calls++;
    }),
  );
  assert.equal(calls, 0);
  await assert.rejects(abortableWait(60000, controller.signal));
});
test("non-rate errors are not retried or given a cooldown", async () => {
  let calls = 0;
  const scheduler = new ProviderScheduler({
    acquire: async () => 0,
    cooldown: async () => {
      assert.fail("unexpected cooldown");
    },
  });
  await assert.rejects(
    scheduler.run("openrouter", 100, undefined, async () => {
      calls++;
      throw Object.assign(new Error("invalid key"), { status: 401 });
    }),
  );
  assert.equal(calls, 1);
  const error = tagProviderError(
    { response: { status: 429, headers: { "retry-after": "1" } } },
    "exa",
  );
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterMs, 2000);
});
