import { env } from "../config/env.js";
import { producerConnection } from "../queues/research.queue.js";
import { SupabaseAuthProvider } from "./provider.js";
import { RedisAuthStore } from "./store.js";
import { Sessions } from "./session.js";

export const authSessions = new Sessions(
  new RedisAuthStore(producerConnection),
  new SupabaseAuthProvider(),
  process.env.NODE_ENV === "production" ||
    new URL(env.FRONTEND_ORIGIN).protocol === "https:",
);
