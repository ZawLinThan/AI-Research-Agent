import type { AuthSession } from "../../shared/auth";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import {
  authAction,
  clearLegacyAuth,
  getSession,
  onSessionChange,
} from "./lib/authApi";
import { Login } from "./pages/login/Login";
import { Recover } from "./pages/recover/Recover";
import { ResetPassword } from "./pages/reset/ResetPassword";
import { Signup } from "./pages/signup/Signup";
import { WorkspacePage } from "./pages/workspace/WorkspacePage";

const authRoutes = {
  "/login": Login,
  "/signup": Signup,
  "/forgot-password": Recover,
  "/reset-password": ResetPassword,
};
export const App = () => {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const navigate = (next: string) => {
    window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", pop);
    let active = true;
    let revision = 0;
    clearLegacyAuth();
    const unsubscribe = onSessionChange((next) => {
      if (!active) return;
      revision++;
      setSession(next);
      setSessionError("");
      setReady(true);
    });
    const restore = () => {
      const current = ++revision;
      void getSession()
        .then(({ session: next }) => {
          if (active && current === revision) {
            setSession(next);
            setReady(true);
            setSessionError("");
          }
        })
        .catch(() => {
          if (active && current === revision) {
            setReady(true);
            setSessionError(
              "Unable to restore your session. Please try again.",
            );
          }
        });
    };
    restore();
    window.addEventListener("focus", restore);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", restore);
      window.removeEventListener("popstate", pop);
    };
  }, []);

  const signOut = async () => {
    try {
      await authAction("logout");
    } catch {
      setSessionError("Sign out failed. Please try again.");
      return;
    }
    setSession(null);
    navigate("/login");
  };

  const Page = authRoutes[path as keyof typeof authRoutes];
  if (Page)
    return (
      <Page key={path} navigate={navigate} session={session} ready={ready} />
    );
  return (
    <WorkspacePage
      key={session?.user.id || "guest"}
      userId={session?.user.id}
      onLogin={() => navigate("/login")}
      accountControls={
        <div className="workspace-auth">
          {session ? (
            <>
              <span title={session.user.email}>{session.user.email}</span>
              <button onClick={signOut}>Sign out</button>
            </>
          ) : (
            <>
              <button onClick={() => navigate("/login")}>Log in</button>
              <button
                className="auth-create"
                onClick={() => navigate("/signup")}
              >
                Sign up <ArrowRight size={13} />
              </button>
            </>
          )}
          {sessionError && <span role="alert">{sessionError}</span>}
        </div>
      }
    />
  );
};
