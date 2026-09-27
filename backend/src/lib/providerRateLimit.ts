import { randomUUID, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type IORedis from "ioredis";
import { PermanentError } from "./errors.js";

export type Provider = "openrouter" | "exa";

export const providerStatus = (error: any): number | undefined =>
  error?.status ?? error?.statusCode ?? error?.response?.status;

const header = (headers: any, name: string): string | undefined =>
  headers?.get?.(name) ?? headers?.[name];

export const retryDelay = (error: any, now = Date.now()): number => {
  const headers = error?.headers ?? error?.response?.headers;
  const retry = header(headers, "retry-after");
  if (retry) {
    const seconds = Number(retry);
    const milliseconds = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retry) - now;
    if (Number.isFinite(milliseconds) && milliseconds >= 0)
      return Math.ceil(milliseconds) + 1000;
  }
  const reset = header(headers, "x-ratelimit-reset-tokens");
  if (reset && /^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(reset)) {
    let milliseconds = 0;
    for (const match of reset.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g))
      milliseconds +=
        Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[match[2]]!;
    return Math.ceil(milliseconds) + 1000;
  }
  return 60000;
};

export const tagProviderError = (error: any, provider: Provider) => {
  if (error && typeof error === "object") {
    error.provider = provider;
    error.status = providerStatus(error);
    if (error.status === 429) error.retryAfterMs = retryDelay(error);
  }
  return error;
};

// Redis time and atomic admission coordinate every worker process using this Redis.
export const admissionScript = `
local clock=redis.call('TIME')
local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
local cooldown=redis.call('PTTL',KEYS[2])
if cooldown>0 then return cooldown end
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now-60000)
local rows=redis.call('ZRANGE',KEYS[1],0,-1,'WITHSCORES')
local tokens=0
for i=1,#rows,2 do tokens=tokens+tonumber(string.match(rows[i],':(%d+)$')) end
if tokens+tonumber(ARGV[1])>tonumber(ARGV[2]) or #rows/2>=tonumber(ARGV[3]) then
  return math.max(1,tonumber(rows[2])+60001-now)
end
redis.call('ZADD',KEYS[1],now,ARGV[4]..':'..ARGV[1])
redis.call('PEXPIRE',KEYS[1],61000)
return 0
`;

export interface ProviderGate {
  acquire(tokens: number): Promise<number>;
  cooldown(milliseconds: number): Promise<void>;
}

export class RedisProviderGate implements ProviderGate {
  private key: string;
  constructor(
    private redis: IORedis,
    group: string,
    private tpm = 1e12,
    private rpm = 1e12,
  ) {
    this.key = `research:provider:{${createHash("sha256").update(group).digest("hex").slice(0, 24)}}`;
  }
  async acquire(tokens: number) {
    if (tokens > this.tpm)
      throw new PermanentError(
        "This research request exceeds the configured AI token-per-minute limit. Narrow the question or configure the allowance for your provider plan.",
      );
    return Number(
      await this.redis.eval(
        admissionScript,
        2,
        this.key,
        `${this.key}:cooldown`,
        Math.ceil(tokens),
        this.tpm,
        this.rpm,
        randomUUID(),
      ),
    );
  }
  async cooldown(milliseconds: number) {
    await this.redis.eval(
      "if redis.call('PTTL',KEYS[1]) < tonumber(ARGV[1]) then redis.call('SET',KEYS[1],'1','PX',ARGV[1]) end; return 1",
      1,
      `${this.key}:cooldown`,
      Math.ceil(milliseconds),
    );
  }
}

export const abortableWait = async (
  milliseconds: number,
  signal?: AbortSignal,
) => {
  while (milliseconds > 0) {
    signal?.throwIfAborted();
    const chunk = Math.min(milliseconds, 30000);
    await delay(chunk, undefined, { signal });
    milliseconds -= chunk;
  }
};

export class ProviderScheduler {
  constructor(
    private gate: ProviderGate,
    private wait = abortableWait,
  ) {}
  async run<T>(
    provider: Provider,
    tokens: number,
    signal: AbortSignal | undefined,
    request: () => Promise<T>,
  ) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      let wait: number;
      while ((wait = await this.gate.acquire(tokens)) > 0)
        await this.wait(wait, signal);
      signal?.throwIfAborted();
      try {
        return await request();
      } catch (error) {
        tagProviderError(error, provider);
        if (providerStatus(error) !== 429) throw error;
        const milliseconds = retryDelay(error);
        await this.gate.cooldown(milliseconds);
        if (attempt >= 2) throw error;
        console.info(
          JSON.stringify({
            event: "provider_rate_limited",
            provider,
            retryAfterMs: milliseconds,
          }),
        );
        await this.wait(milliseconds, signal);
      }
    }
  }
}

const schedulers = new Map<Provider, ProviderScheduler>();

export const configureProviderScheduler = (
  provider: Provider,
  scheduler?: ProviderScheduler,
) => {
  if (scheduler) schedulers.set(provider, scheduler);
  else schedulers.delete(provider);
};

export const scheduleProviderRequest = async <T>(
  provider: Provider,
  tokens: number,
  signal: AbortSignal | undefined,
  request: () => Promise<T>,
) => {
  try {
    const scheduler = schedulers.get(provider);
    return scheduler
      ? await scheduler.run(provider, tokens, signal, request)
      : await request();
  } catch (error) {
    throw tagProviderError(error, provider);
  }
};

export const providerBackoff = (
  attempts: number,
  _type: string | undefined,
  error: any,
) => Math.max(30000 * 2 ** Math.max(0, attempts - 1), error?.retryAfterMs ?? 0);
