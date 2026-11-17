import express from "express";
import cors from "cors";
import { z } from "zod";
import researchRouter from "./routes/research.route.js";
import { RequestError } from "./services/research.service.js";
import { env } from "./config/env.js";
import { authSessions } from "./auth/index.js";
import { authRouter, csrfProtection } from "./auth/routes.js";
import { AuthError } from "./auth/provider.js";

export const app = express();

const frontendUrl = new URL(env.FRONTEND_ORIGIN);
const localDevelopment =
  process.env.NODE_ENV !== "production" &&
  ["localhost", "127.0.0.1"].includes(frontendUrl.hostname);
const origins = [
  ...new Set([
    frontendUrl.origin,
    ...(localDevelopment
      ? ["http://localhost:5173", "http://127.0.0.1:5173"]
      : []),
  ]),
];

if (env.TRUST_PROXY) {
  app.set("trust proxy", env.TRUST_PROXY);
}

app.disable("x-powered-by");
app.use(
  cors({
    origin: origins,
    credentials: true,
    allowedHeaders: ["Content-Type", "X-CSRF-Protection"],
  }),
);
app.use(express.json({ limit: "16kb" }));
app.use("/api", csrfProtection(origins));
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(
  "/api/auth",
  authRouter(
    authSessions,
    new URL(env.FRONTEND_ORIGIN).origin,
    env.AUTH_CALLBACK_URL,
  ),
);
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/research", researchRouter);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if ((error as { type?: string })?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Invalid JSON request." });
      return;
    }

    if ((error as { type?: string })?.type === "entity.too.large") {
      res.status(413).json({ error: "Request is too large." });
      return;
    }

    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Invalid request. Check the supplied fields.",
        issues: error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      });
      return;
    }

    if (error instanceof RequestError || error instanceof AuthError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    console.error("Research API request failed");
    res.status(500).json({
      error: "Research is temporarily unavailable. Please try again.",
    });
  },
);
