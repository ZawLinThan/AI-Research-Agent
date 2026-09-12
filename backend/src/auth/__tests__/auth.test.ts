import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import {
  AuthError,
  SupabaseAuthProvider,
  type AuthProvider,
  type Tokens,
} from "../provider.js";
import { Sessions } from "../session.js";
import { authRouter, csrfProtection, sessionUser } from "../routes.js";
import type { AuthStore } from "../store.js";

class MemoryStore implements AuthStore {
  rows = new Map<string, string>();
  async get(k: string) {
    return this.rows.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.rows.set(k, v);
  }
  async take(k: string) {
    const v = await this.get(k);
    this.rows.delete(k);
    return v;
  }
  async remove(k: string) {
    this.rows.delete(k);
  }
  async acquire(k: string, v: string) {
    if (this.rows.has(k)) return false;
    this.rows.set(k, v);
    return true;
  }
  async replace(k: string, old: string, v: string) {
    if (this.rows.get(k) !== old) return false;
    this.rows.set(k, v);
    return true;
  }
  async release(k: string, v: string) {
    if (this.rows.get(k) === v) this.rows.delete(k);
  }
  async increment(k: string) {
    const n = Number(this.rows.get(k) ?? 0) + 1;
    this.rows.set(k, String(n));
    return n;
  }
}
const tokens: Tokens = {
  access_token: "private-access",
  refresh_token: "private-refresh",
  expires_in: 3600,
  user: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    email: "person@example.test",
  },
};
const provider = (): AuthProvider => ({
  login: async () => tokens,
  signup: async () => null,
  recover: async () => {},
  exchange: async () => tokens,
  refresh: async () => ({
    ...tokens,
    access_token: "new-access",
    refresh_token: "new-refresh",
  }),
  password: async () => {},
  logout: async () => {},
});
const request = (cookie = "") => ({ headers: { cookie } }) as Request;
const response = () => {
  const cookies: {
    name: string;
    value: string;
    options: Record<string, unknown>;
  }[] = [];
  return {
    cookies,
    res: {
      cookie(name: string, value: string, options: Record<string, unknown>) {
        cookies.push({ name, value, options });
      },
      clearCookie() {},
    } as unknown as Response,
  };
};
const setup = async (expires_in = 3600) => {
  const store = new MemoryStore(),
    upstream = provider(),
    sessions = new Sessions(store, upstream, true);
  const out = response();
  await sessions.create(request(), out.res, { ...tokens, expires_in });
  return {
    store,
    upstream,
    sessions,
    req: request(`${out.cookies[0].name}=${out.cookies[0].value}`),
    out,
  };
};

test("session cookie is opaque, HttpOnly, host-only and Secure; Redis holds the tokens", async () => {
  const { sessions, store, req, out } = await setup();
  assert.equal(out.cookies[0].name, "__Host-fieldwork-session");
  assert.match(out.cookies[0].value, /^[a-f0-9]{64}$/);
  assert.deepEqual(out.cookies[0].options, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 2592000000,
  });
  assert.equal((await sessions.read(req, out.res))?.user.id, tokens.user.id);
  assert.ok([...store.rows.values()][0].includes("private-refresh"));
  assert.ok(![...store.rows.keys()][0].includes(out.cookies[0].value));
});

test("login rotates the session ID and invalidates the previous ID", async () => {
  const { sessions, req, out } = await setup();
  const next = response();
  await sessions.create(req, next.res, tokens);
  assert.notEqual(next.cookies[0].value, out.cookies[0].value);
  assert.equal(await sessions.read(req, out.res), null);
});

test("refresh rotates server-side tokens, and preserves the absolute session deadline", async () => {
  const { sessions, store, req, out } = await setup(1);
  const before = JSON.parse([...store.rows.values()][0]);
  assert.equal((await sessions.read(req, out.res))?.access_token, "new-access");
  const after = JSON.parse([...store.rows.values()][0]);
  assert.equal(after.refresh_token, "new-refresh");
  assert.equal(before.deadline, after.deadline);
});

test("logout during refresh cannot resurrect a session; refresh lock blocks a competing refresh", async () => {
  const { sessions, upstream, req, out, store } = await setup(1);
  let finish!: (value: Tokens) => void;
  let started!: () => void;
  const called = new Promise<void>((resolve) => {
    started = resolve;
  });
  upstream.refresh = () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = sessions.read(req, out.res);
  await called;
  await assert.rejects(
    sessions.read(req, out.res),
    (e: unknown) => e instanceof AuthError && e.status === 503,
  );
  await sessions.logout(req, out.res);
  finish(tokens);
  assert.equal(await pending, null);
  assert.equal(store.rows.size, 0);
});

test("invalid refresh clears the session; transient errors preserve it for retry", async () => {
  const { sessions, upstream, req, out, store } = await setup(1);
  upstream.refresh = async () => {
    throw new AuthError(503, "unavailable");
  };
  await assert.rejects(sessions.read(req, out.res));
  assert.equal(store.rows.size, 1);
  upstream.refresh = async () => {
    throw new AuthError(401, "revoked");
  };
  assert.equal(await sessions.read(req, out.res), null);
  assert.equal(store.rows.size, 0);
});

test("expired, missing, malformed and duplicate cookies cannot authenticate", async () => {
  const { sessions, store, req, out } = await setup();
  const [key, raw] = [...store.rows.entries()][0];
  store.rows.set(
    key,
    JSON.stringify({ ...JSON.parse(raw), deadline: Date.now() - 1 }),
  );
  assert.equal(await sessions.read(req, out.res), null);
  assert.equal(
    await sessions.read(request("__Host-fieldwork-session=invalid"), out.res),
    null,
  );
  assert.equal(
    sessions.cookie(request(`${req.headers.cookie}; ${req.headers.cookie}`)),
    null,
  );
});

test("PKCE verifier stays server-side and flows are browser-bound and single-use", async () => {
  const { sessions, out } = await setup();
  const flow = await sessions.beginFlow(
    request(),
    out.res,
    "https://app.test",
    true,
  );
  await assert.rejects(sessions.finishFlow(request(), flow.id));
  const req = request(`${sessions.flowCookieName}=${flow.id}`);
  const saved = await sessions.finishFlow(req, flow.id);
  assert.equal(
    createHash("sha256").update(saved.verifier).digest("base64url"),
    flow.challenge,
  );
  assert.equal(saved.recovery, true);
  await assert.rejects(sessions.finishFlow(req, flow.id));
});

test("HTTP auth flow protects writes, hides tokens, restores sessions and logs out", async (t) => {
  const store = new MemoryStore(),
    upstream = provider(),
    sessions = new Sessions(store, upstream, true);
  const app = express();
  app.use(express.json());
  app.use(csrfProtection(["https://app.test"]));
  app.use("/api/auth", authRouter(sessions, "https://app.test"));
  app.post("/api/research", sessionUser(sessions), (_req, res) =>
    res.json({ owner: res.locals.ownerId }),
  );
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res
      .status(
        e instanceof AuthError ? e.status : e instanceof z.ZodError ? 400 : 500,
      )
      .json({ error: "Request failed" });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  );
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = {
    Origin: "https://app.test",
    "X-CSRF-Protection": "1",
    "Content-Type": "application/json",
  };
  const loginBody = JSON.stringify({
    email: tokens.user.email,
    password: "password123",
  });
  assert.equal(
    (
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        body: loginBody,
        headers: { "Content-Type": "application/json" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        body: loginBody,
        headers: { ...headers, Origin: "https://evil.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        body: "{}",
        headers,
      })
    ).status,
    400,
  );
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    body: loginBody,
    headers,
  });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { session: { user: tokens.user } });
  const cookie = login.headers.getSetCookie()[0].split(";")[0];
  assert.match(login.headers.getSetCookie()[0], /HttpOnly/);
  assert.match(login.headers.getSetCookie()[0], /Secure/);
  assert.equal(login.headers.get("cache-control"), "no-store");
  const restored = await fetch(`${base}/api/auth/session`, {
    headers: { Cookie: cookie },
  });
  assert.deepEqual(await restored.json(), { session: { user: tokens.user } });
  assert.equal(
    (await fetch(`${base}/api/research`, { method: "POST", headers })).status,
    401,
  );
  const research = await fetch(`${base}/api/research`, {
    method: "POST",
    headers: { ...headers, Cookie: cookie },
  });
  assert.deepEqual(await research.json(), { owner: tokens.user.id });
  assert.equal(
    (
      await fetch(`${base}/api/auth/logout`, {
        method: "POST",
        headers: { ...headers, Cookie: cookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/api/research`, {
        method: "POST",
        headers: { ...headers, Cookie: cookie },
      })
    ).status,
    401,
  );

  let redirect = "",
    challenge = "";
  upstream.recover = async (_email, url, hash) => {
    redirect = url;
    challenge = hash;
  };
  const recover = await fetch(`${base}/api/auth/recover`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: tokens.user.email }),
  });
  const flowCookie = recover.headers.getSetCookie()[0].split(";")[0];
  upstream.exchange = async (_code, verifier) => {
    assert.equal(
      createHash("sha256").update(verifier).digest("base64url"),
      challenge,
    );
    return tokens;
  };
  const callbackPath =
    new URL(redirect).pathname +
    new URL(redirect).search +
    "&code=one-time-code";
  const wrongBrowser = await fetch(`${base}${callbackPath}`, {
    redirect: "manual",
  });
  assert.match(wrongBrowser.headers.get("location")!, /error=auth_callback/);
  const callback = await fetch(`${base}${callbackPath}`, {
    redirect: "manual",
    headers: { Cookie: flowCookie },
  });
  assert.equal(
    callback.headers.get("location"),
    "https://app.test/reset-password",
  );
  const recoverySession = callback.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${sessions.cookieName}=`))!
    .split(";")[0];
  let updated = false;
  upstream.password = async (token, password) => {
    assert.equal(token, tokens.access_token);
    assert.equal(password, "new-password");
    updated = true;
  };
  assert.equal(
    (
      await fetch(`${base}/api/auth/password`, {
        method: "POST",
        headers: { ...headers, Cookie: recoverySession },
        body: JSON.stringify({ password: "new-password" }),
      })
    ).status,
    200,
  );
  assert.ok(updated);
  assert.deepEqual(
    await (
      await fetch(`${base}/api/auth/session`, {
        headers: { Cookie: recoverySession },
      })
    ).json(),
    { session: null },
  );

  const signup = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: tokens.user.email,
      password: "password123",
      name: "Person",
    }),
  });
  assert.deepEqual(await signup.json(), { session: null });
  upstream.signup = async () => tokens;
  const immediate = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: tokens.user.email,
      password: "password123",
      name: "Person",
    }),
  });
  assert.deepEqual(await immediate.json(), { session: { user: tokens.user } });
  for (let n = 0; n < 31; n++)
    await store.increment(
      `auth:rate:${createHash("sha256").update("127.0.0.1").digest("hex")}`,
    );
  assert.equal(
    (
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers,
        body: loginBody,
      })
    ).status,
    429,
  );
});

test("provider adapter uses PKCE and refresh grants and never returns metadata to the browser", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      assert.equal(
        (options.headers as Record<string, string>).apikey,
        "sb_publishable_test",
      );
      if (url.includes("grant_type=pkce"))
        assert.deepEqual(JSON.parse(options.body as string), {
          auth_code: "code",
          code_verifier: "verifier",
        });
      if (url.includes("grant_type=refresh_token"))
        assert.deepEqual(JSON.parse(options.body as string), {
          refresh_token: "refresh",
        });
      return Response.json({
        ...tokens,
        user: { ...tokens.user, user_metadata: { secret: "hidden" } },
      });
    },
  );
  const oldUrl = process.env.SUPABASE_URL,
    oldKey = process.env.SUPABASE_PUBLISHABLE_KEY,
    oldKeys = process.env.SUPABASE_PUBLISHABLE_KEYS;
  process.env.SUPABASE_URL = "https://project.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  delete process.env.SUPABASE_PUBLISHABLE_KEYS;
  t.after(() => {
    for (const [key, value] of Object.entries({
      SUPABASE_URL: oldUrl,
      SUPABASE_PUBLISHABLE_KEY: oldKey,
      SUPABASE_PUBLISHABLE_KEYS: oldKeys,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const upstream = new SupabaseAuthProvider();
  assert.deepEqual(await upstream.exchange("code", "verifier"), tokens);
  assert.deepEqual(await upstream.refresh("refresh"), tokens);
});
