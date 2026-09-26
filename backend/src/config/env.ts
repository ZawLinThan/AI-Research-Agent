import "dotenv/config";
import { z } from "zod";
export const env = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
    AUTH_CALLBACK_URL: z.string().url().optional(),
    TRUST_PROXY: z.string().optional(),
    SUPABASE_JWKS_URL: z.string().url().optional(),
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().default(3000),
    REDIS_URL: z.string().optional(),
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().optional(),
    GROQ_API_KEY: z.string().min(1),
    GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
    EXA_API_KEY: z.string().min(1),
    FRONTEND_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  })
  .parse(process.env);
