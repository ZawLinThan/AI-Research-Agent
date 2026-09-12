import type { AuthSession } from "../../../shared/auth";
export type AuthPage =
  "/login" | "/signup" | "/forgot-password" | "/reset-password";
export type AuthPageProps = {
  navigate: (path: string) => void;
  session: AuthSession | null;
  ready: boolean;
};
