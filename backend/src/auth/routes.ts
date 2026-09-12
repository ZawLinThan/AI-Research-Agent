import { Router, type RequestHandler } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { AuthError } from "./provider.js";
import type { Sessions } from "./session.js";

export const csrfProtection =
  (origins: string[]): RequestHandler =>
  (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (
      !origins.includes(req.headers.origin ?? "") ||
      req.headers["x-csrf-protection"] !== "1"
    ) {
      res.status(403).json({ error: "Request origin could not be verified." });
      return;
    }
    next();
  };

export const sessionUser =
  (sessions: Sessions): RequestHandler =>
  async (req, res, next) => {
    const session = await sessions.read(req, res);
    if (!session) {
      res.status(401).json({ error: "Please log in to continue." });
      return;
    }
    res.locals.ownerId = session.user.id;
    res.locals.authSession = session;
    next();
  };

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
});

export function authRouter(
  sessions: Sessions,
  frontendOrigin: string,
  callbackUrl?: string,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  router.get("/session", async (req, res) => {
    const session = await sessions.read(req, res);
    res.json({ session: session ? { user: session.user } : null });
  });
  router.post("/logout", async (req, res) => {
    await sessions.logout(req, res);
    res.json({ session: null });
  });
  // Rate limit before provider calls. Forwarded IP headers are not trusted.
  const limit: RequestHandler = async (req, res, next) => {
    const ip = createHash("sha256")
      .update(req.ip ?? "unknown")
      .digest("hex");
    if ((await sessions.store.increment(`auth:rate:${ip}`, 600)) > 30) {
      res
        .status(429)
        .json({
          error: "Too many authentication attempts. Please try again later.",
        });
      return;
    }
    next();
  };
  router.post("/login", limit, async (req, res) => {
    const input = credentials.parse(req.body);
    const tokens = await sessions.provider.login(input.email, input.password);
    res.json({ session: await sessions.create(req, res, tokens) });
  });
  router.post("/signup", limit, async (req, res) => {
    const input = credentials
      .extend({
        password: z.string().min(8).max(1024),
        name: z.string().trim().max(200),
      })
      .parse(req.body);
    const origin = req.headers.origin!; // checked by csrfProtection
    const flow = await sessions.beginFlow(req, res, origin, false);
    const callback = new URL(callbackUrl ?? `${origin}/api/auth/callback`);
    callback.searchParams.set("state", flow.id);
    const tokens = await sessions.provider.signup(
      input.email,
      input.password,
      input.name,
      callback.href,
      flow.challenge,
    );
    if (tokens) {
      await sessions.discardFlow(flow.id);
      sessions.clearFlow(res);
    }
    res.json({
      session: tokens ? await sessions.create(req, res, tokens) : null,
    });
  });
  router.post("/recover", limit, async (req, res) => {
    const { email } = credentials.pick({ email: true }).parse(req.body);
    const origin = req.headers.origin!;
    const flow = await sessions.beginFlow(req, res, origin, true);
    const callback = new URL(callbackUrl ?? `${origin}/api/auth/callback`);
    callback.searchParams.set("state", flow.id);
    try {
      await sessions.provider.recover(email, callback.href, flow.challenge);
    } catch (error) {
      if (!(error instanceof AuthError) || error.status !== 401) throw error;
    }
    res.json({ ok: true });
  });
  router.post("/password", sessionUser(sessions), async (req, res) => {
    const { password } = z
      .object({ password: z.string().min(8).max(1024) })
      .parse(req.body);
    await sessions.provider.password(
      res.locals.authSession.access_token,
      password,
    );
    await sessions.logout(req, res);
    res.json({ session: null });
  });
  router.get("/callback", limit, async (req, res) => {
    let origin = frontendOrigin;
    let recovery = false;
    try {
      const { code, state } = z
        .object({
          code: z.string().min(1).max(2048),
          state: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .parse(req.query);
      const flow = await sessions.finishFlow(req, state);
      origin = flow.origin;
      recovery = flow.recovery;
      const tokens = await sessions.provider.exchange(code, flow.verifier);
      await sessions.create(req, res, tokens);
      sessions.clearFlow(res);
      res.redirect(303, `${origin}${recovery ? "/reset-password" : "/"}`);
    } catch {
      sessions.clearFlow(res);
      res.redirect(
        303,
        `${origin}${recovery ? "/reset-password" : "/login"}?error=auth_callback`,
      );
    }
  });
  return router;
}
