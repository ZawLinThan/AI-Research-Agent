import { resolveEnv } from "@supabase/server/core";
import { z } from "zod";

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().optional(),
});
const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  user: userSchema,
});
export type Tokens = z.infer<typeof tokensSchema>;
export interface AuthProvider {
  login(email: string, password: string): Promise<Tokens>;
  signup(
    email: string,
    password: string,
    name: string,
    redirect: string,
    challenge: string,
  ): Promise<Tokens | null>;
  recover(email: string, redirect: string, challenge: string): Promise<void>;
  exchange(code: string, verifier: string): Promise<Tokens>;
  refresh(token: string): Promise<Tokens>;
  password(token: string, password: string): Promise<void>;
  logout(token: string): Promise<void>;
}

// Server-only Auth API adapter. PKCE verifiers and provider tokens never reach JS in the browser.
export class SupabaseAuthProvider implements AuthProvider {
  private async request(
    path: string,
    body?: unknown,
    token?: string,
    method = "POST",
  ): Promise<unknown> {
    const { data: config, error } = resolveEnv();
    const key =
      config?.publishableKeys.default ??
      Object.values(config?.publishableKeys ?? {})[0];
    if (error || !config || !key)
      throw new AuthError(503, "Authentication is not configured.");
    let response: globalThis.Response;
    try {
      response = await fetch(`${config.url}/auth/v1/${path}`, {
        method,
        headers: {
          apikey: key,
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new AuthError(
        503,
        "Authentication is temporarily unavailable. Please try again.",
      );
    }
    if (!response.ok) {
      if (response.status === 429)
        throw new AuthError(
          429,
          "Too many authentication attempts. Please try again later.",
        );
      if (response.status >= 500)
        throw new AuthError(503, "Authentication is temporarily unavailable.");
      throw new AuthError(
        401,
        "Authentication failed. Check your credentials or request a new email link.",
      );
    }
    return response.status === 204 ? null : response.json();
  }
  async login(email: string, password: string) {
    return tokensSchema.parse(
      await this.request("token?grant_type=password", { email, password }),
    );
  }
  async signup(
    email: string,
    password: string,
    name: string,
    redirect: string,
    challenge: string,
  ) {
    const result = await this.request(
      `signup?redirect_to=${encodeURIComponent(redirect)}`,
      {
        email,
        password,
        data: { full_name: name },
        code_challenge: challenge,
        code_challenge_method: "s256",
      },
    );
    if (result && typeof result === "object" && "access_token" in result)
      return tokensSchema.parse(result);
    return null;
  }
  async recover(email: string, redirect: string, challenge: string) {
    await this.request(`recover?redirect_to=${encodeURIComponent(redirect)}`, {
      email,
      code_challenge: challenge,
      code_challenge_method: "s256",
    });
  }
  async exchange(code: string, verifier: string) {
    return tokensSchema.parse(
      await this.request("token?grant_type=pkce", {
        auth_code: code,
        code_verifier: verifier,
      }),
    );
  }
  async refresh(token: string) {
    return tokensSchema.parse(
      await this.request("token?grant_type=refresh_token", {
        refresh_token: token,
      }),
    );
  }
  async password(token: string, password: string) {
    await this.request("user", { password }, token, "PUT");
  }
  async logout(token: string) {
    await this.request("logout?scope=local", undefined, token);
  }
}
