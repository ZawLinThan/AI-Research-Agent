import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { AuthSession } from "../../../shared/auth.js";
import { AuthError, type AuthProvider, type Tokens } from "./provider.js";
import type { AuthStore } from "./store.js";

const lifetime = 30 * 86400;
const flowLifetime = 3600;
const opaque = () => randomBytes(32).toString("hex");
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type StoredSession = Tokens & { expiresAt: number; deadline: number };
type Flow = { verifier: string; origin: string; recovery: boolean };

export class Sessions {
  readonly cookieName: string;
  readonly flowCookieName: string;
  constructor(
    readonly store: AuthStore,
    readonly provider: AuthProvider,
    readonly secure: boolean,
  ) {
    this.cookieName = secure ? "__Host-fieldwork-session" : "fieldwork-session";
    this.flowCookieName = secure
      ? "__Host-fieldwork-auth-flow"
      : "fieldwork-auth-flow";
  }
  cookie(req: Request, name = this.cookieName) {
    const values = (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const value = values[0].slice(name.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  private options(maxAge: number) {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: "lax" as const,
      path: "/",
      maxAge,
    };
  }
  private key(id: string) {
    return `auth:session:${digest(id)}`;
  }
  clear(res: Response) {
    res.clearCookie(this.cookieName, this.options(0));
  }
  clearFlow(res: Response) {
    res.clearCookie(this.flowCookieName, this.options(0));
  }
  async create(
    req: Request,
    res: Response,
    tokens: Tokens,
  ): Promise<AuthSession> {
    const id = opaque();
    const data: StoredSession = {
      ...tokens,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      deadline: Date.now() + lifetime * 1000,
    };
    await this.store.put(this.key(id), JSON.stringify(data), lifetime);
    const old = this.cookie(req);
    if (old) await this.store.remove(this.key(old));
    res.cookie(this.cookieName, id, this.options(lifetime * 1000));
    return { user: tokens.user };
  }
  async read(req: Request, res: Response): Promise<StoredSession | null> {
    const id = this.cookie(req);
    if (!id) return null;
    const key = this.key(id);
    let raw = await this.store.get(key);
    if (!raw) {
      this.clear(res);
      return null;
    }
    let data: StoredSession = JSON.parse(raw);
    if (data.deadline <= Date.now()) {
      await this.store.remove(key);
      this.clear(res);
      return null;
    }
    if (data.expiresAt > Date.now() + 60000) return data;
    const lock = opaque();
    // Serialize refreshes across API processes: Supabase refresh tokens rotate.
    if (!(await this.store.acquire(`${key}:lock`, lock, 30))) {
      throw new AuthError(
        503,
        "Your session is refreshing. Please try again shortly.",
      );
    }
    try {
      raw = await this.store.get(key);
      if (!raw) return null;
      data = JSON.parse(raw);
      if (data.expiresAt > Date.now() + 60000) return data;
      const tokens = await this.provider.refresh(data.refresh_token);
      if (tokens.user.id !== data.user.id)
        throw new AuthError(401, "Your session is invalid.");
      const next = {
        ...tokens,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        deadline: data.deadline,
      };
      const ttl = Math.ceil((data.deadline - Date.now()) / 1000);
      // A concurrent logout must never be undone by a late refresh response.
      if (
        ttl <= 0 ||
        !(await this.store.replace(key, raw, JSON.stringify(next), ttl))
      )
        return null;
      return next;
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        await this.store.remove(key);
        this.clear(res);
        return null;
      }
      throw error;
    } finally {
      await this.store.release(`${key}:lock`, lock);
    }
  }
  async logout(req: Request, res: Response) {
    const id = this.cookie(req);
    if (id) {
      const raw = await this.store.take(this.key(id));
      if (raw) {
        // Local invalidation succeeds even if the upstream provider is unavailable.
        try {
          await this.provider.logout(
            (JSON.parse(raw) as StoredSession).access_token,
          );
        } catch {
          /* already invalidated */
        }
      }
    }
    this.clear(res);
    const flow = this.cookie(req, this.flowCookieName);
    if (flow) await this.store.remove(`auth:flow:${digest(flow)}`);
    this.clearFlow(res);
  }
  async beginFlow(
    req: Request,
    res: Response,
    origin: string,
    recovery: boolean,
  ) {
    const previous = this.cookie(req, this.flowCookieName);
    if (previous) await this.store.remove(`auth:flow:${digest(previous)}`);
    const id = opaque();
    const verifier = randomBytes(32).toString("base64url");
    await this.store.put(
      `auth:flow:${digest(id)}`,
      JSON.stringify({ verifier, origin, recovery }),
      flowLifetime,
    );
    res.cookie(this.flowCookieName, id, this.options(flowLifetime * 1000));
    return {
      id,
      challenge: createHash("sha256").update(verifier).digest("base64url"),
    };
  }
  async discardFlow(id: string) {
    await this.store.remove(`auth:flow:${digest(id)}`);
  }
  async finishFlow(req: Request, state: string): Promise<Flow> {
    if (this.cookie(req, this.flowCookieName) !== state)
      throw new AuthError(
        401,
        "Open this email link in the browser where you requested it.",
      );
    const raw = await this.store.take(`auth:flow:${digest(state)}`);
    if (!raw)
      throw new AuthError(
        401,
        "This email link expired. Please request a new one.",
      );
    return JSON.parse(raw);
  }
}
