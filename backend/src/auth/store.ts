import type IORedis from "ioredis";

export interface AuthStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttl: number): Promise<void>;
  take(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  acquire(key: string, value: string, ttl: number): Promise<boolean>;
  replace(
    key: string,
    old: string,
    value: string,
    ttl: number,
  ): Promise<boolean>;
  release(key: string, value: string): Promise<void>;
  increment(key: string, ttl: number): Promise<number>;
}

export class RedisAuthStore implements AuthStore {
  constructor(private redis: IORedis) {}

  get(key: string) {
    return this.redis.get(key);
  }

  async put(key: string, value: string, ttl: number) {
    await this.redis.set(key, value, "EX", ttl);
  }

  take(key: string) {
    return this.redis.getdel(key);
  }

  async remove(key: string) {
    await this.redis.del(key);
  }

  async acquire(key: string, value: string, ttl: number) {
    return (await this.redis.set(key, value, "EX", ttl, "NX")) === "OK";
  }

  async replace(key: string, old: string, value: string, ttl: number) {
    return (
      Number(
        await this.redis.eval(
          "if redis.call('GET',KEYS[1]) == ARGV[1] then \
          redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1 else return 0 end",
          1,
          key,
          old,
          value,
          ttl,
        ),
      ) === 1
    );
  }

  async release(key: string, value: string) {
    await this.redis.eval(
      "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
      1,
      key,
      value,
    );
  }

  async increment(key: string, ttl: number) {
    return Number(
      await this.redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        1,
        key,
        ttl,
      ),
    );
  }
}
