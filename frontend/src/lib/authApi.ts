import type { AuthSession } from "../../../shared/auth";

const events = new EventTarget();
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("fieldwork-auth");

export const apiRequest = async <T>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-CSRF-Protection", "1");
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL || ""}/api${path}`,
    {
      ...options,
      headers,
      credentials: "include",
      cache: "no-store",
    },
  );
  const body = await response
    .json()
    .catch(() => ({ error: "The server could not be reached." }));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/")) notify(null);
    throw new Error(body.error || "The request failed.");
  }
  return body as T;
};

const notify = (session: AuthSession | null) => {
  events.dispatchEvent(new CustomEvent("session", { detail: session }));
};

export const getSession = () =>
  apiRequest<{ session: AuthSession | null }>("/auth/session");
export const onSessionChange = (
  listener: (session: AuthSession | null) => void,
) => {
  const handler = (event: Event) =>
    listener((event as CustomEvent<AuthSession | null>).detail);
  events.addEventListener("session", handler);
  return () => events.removeEventListener("session", handler);
};

export const authAction = async (
  action: "login" | "signup" | "recover" | "password" | "logout",
  input?: unknown,
) => {
  const result = await apiRequest<{ session?: AuthSession | null }>(
    `/auth/${action}`,
    {
      method: "POST",
      body: input === undefined ? undefined : JSON.stringify(input),
    },
  );
  if (result.session !== undefined) {
    notify(result.session);
    channel?.postMessage("changed");
  }
  return result;
};

if (channel)
  channel.onmessage = () => {
    void getSession()
      .then(({ session }) => notify(session))
      .catch(() => {});
  };

// Remove only the former Supabase client's credentials for this project.
// Existing sessions intentionally require a fresh login; tokens are not migrated through JS.
export const clearLegacyAuth = () => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return;
  try {
    const prefix = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
    for (const key of Object.keys(localStorage)) {
      if (key === prefix || key.startsWith(`${prefix}-`))
        localStorage.removeItem(key);
    }
  } catch {
    /* Storage may be disabled by browser settings. */
  }
};
