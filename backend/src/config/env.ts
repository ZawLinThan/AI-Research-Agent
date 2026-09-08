import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().min(1),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_JWKS_URL: z.string().min(1),

  DATABASE_URL: z.string().min(1),

  PORT: z.coerce.number().default(3000),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
