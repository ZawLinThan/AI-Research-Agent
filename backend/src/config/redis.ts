import IORedis from "ioredis";
import { env } from "./env.js";

export function createRedis(worker = false) {
  const options = {
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    connectTimeout: 3000,
    ...(!env.REDIS_URL
      ? {
          host: env.REDIS_HOST,
          port: env.REDIS_PORT,
        }
      : {}),
  };
  
  const connection = env.REDIS_URL
    ? new IORedis(env.REDIS_URL, options)
    : new IORedis(options);
  connection.on("error", () => {});
  return connection;
}
