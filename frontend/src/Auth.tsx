import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Eye,
  EyeOff,
  FlaskConical,
  LoaderCircle,
  Mail,
  Sparkles,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import App from "./App";
import "./auth.css";

type AuthPage = "/login" | "/signup" | "/forgot-password" | "/reset-password";
const authPages = ["/login", "/signup", "/forgot-password", "/reset-password"];

export default function AuthRoot() {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [sessionError, setSessionError] = useState("");
  function navigate(next: string) {
    window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", pop);
    if (!supabase) return () => window.removeEventListener("popstate", pop);
    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      setSession(next);
      setReady(true);
      if (event === "PASSWORD_RECOVERY") {
        window.history.replaceState({}, "", "/reset-password");
        setPath("/reset-password");
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) {
          setSession(data.session);
          setReady(true);
          if (error)
            setSessionError(
              "Your session could not be restored. Please sign in again.",
            );
        }
      })
      .catch(() => {
        if (active) {
          setReady(true);
          setSessionError(
            "Unable to restore your session. Please sign in again.",
          );
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener("popstate", pop);
    };
  }, []);
  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSessionError("Sign out failed. Please try again.");
      return;
    }
    setSession(null);
    navigate("/login");
  }
  if (authPages.includes(path))
    return (
      <AuthPageView
        key={path}
        page={path as AuthPage}
        navigate={navigate}
        session={session}
        ready={ready}
      />
    );
  return (
    <App
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
}

function AuthPageView({
  page,
  navigate,
  session,
  ready,
}: {
  page: AuthPage;
  navigate: (path: string) => void;
  session: Session | null;
  ready: boolean;
}) {
  const signup = page === "/signup",
    recovery = page === "/forgot-password",
    reset = page === "/reset-password";
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() =>
    new URLSearchParams(window.location.hash.slice(1)).has("error")
      ? "This email link is invalid or has expired. Please request a new link."
      : "",
  );
  const [success, setSuccess] = useState(false);
  const title = signup
    ? "A new space for your curiosity."
    : recovery
      ? "Let’s get you back in."
      : reset
        ? "A fresh start. A new password."
        : "Welcome back.";
  useEffect(() => {
    document.title = `${signup ? "Sign up" : recovery ? "Password recovery" : reset ? "Reset password" : "Log in"} — Fieldwork`;
    return () => {
      document.title = "Fieldwork — Research workspace";
    };
  }, [signup, recovery, reset]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!supabase) {
      setError(
        "Authentication is not configured yet. Please try again once setup is complete.",
      );
      return;
    }
    if ((signup || reset) && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }
    if (reset && password !== confirm) {
      setError("The passwords do not match. Please try again.");
      return;
    }
    if (reset && !session) {
      setError(
        "Open the link in your recovery email before choosing a new password.",
      );
      return;
    }
    setBusy(true);
    try {
      if (recovery) {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: `${window.location.origin}/reset-password` },
        );
        if (error) throw error;
        setSuccess(true);
      } else if (reset) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setPassword("");
        setConfirm("");
        setSuccess(true);
      } else if (signup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: name.trim() },
            emailRedirectTo: `${window.location.origin}/login`,
          },
        });
        if (error) throw error;
        setPassword("");
        if (data.session) navigate("/");
        else setSuccess(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        navigate("/");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function link(event: React.MouseEvent<HTMLAnchorElement>, to: string) {
    event.preventDefault();
    if (!busy) navigate(to);
  }
  const resetUnavailable = reset && ready && !session;
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <a className="brand" href="/" onClick={(e) => link(e, "/")}>
          <span className="brand-mark">
            <FlaskConical size={21} />
          </span>
          fieldwork<span className="brand-dot">.</span>
        </a>
        <div className="story-content">
          <span className="auth-kicker">
            <span /> A WORKSPACE FOR DISCOVERY
          </span>
          <h1>
            Follow your
            <br />
            curiosity.
            <br />
            <em>Find your clarity.</em>
          </h1>
          <p>
            Give your questions room to grow.
            <br />
            Bring your research into focus.
          </p>
          <div className="discovery-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="orbit-center">
              <Sparkles size={32} strokeWidth={1.2} />
            </div>
            <span className="orbit-point point-one" />
            <span className="orbit-point point-two" />
            <span className="art-caption caption-one">A QUESTION</span>
            <span className="art-caption caption-two">A NEW PERSPECTIVE</span>
          </div>
        </div>
        <div className="story-foot">
          <BookOpen size={16} />
          <span>Good questions are just the beginning.</span>
          <span className="edition">FIELD NOTES / 01</span>
        </div>
      </aside>
      <section className="auth-main">
        <header className="auth-top">
          <a href="/" onClick={(e) => link(e, "/")}>
            <ArrowLeft size={14} /> Back to workspace
          </a>
          <span>
            {signup ? "Already have an account?" : "New to Fieldwork?"}{" "}
            <a
              href={signup ? "/login" : "/signup"}
              onClick={(e) => link(e, signup ? "/login" : "/signup")}
            >
              {signup ? "Log in" : "Sign up"} <ArrowUp />
            </a>
          </span>
        </header>
        <div className="auth-form-wrap">
          {success ? (
            <div className="auth-success">
              <span className="auth-state-icon">
                {reset ? <Check size={26} /> : <Mail size={26} />}
              </span>
              <span className="eyebrow">
                {reset ? "YOU’RE ALL SET" : "ONE MORE STEP"}
              </span>
              <h2>{reset ? "Password updated." : "Check your inbox."}</h2>
              <p>
                {reset
                  ? "Your new password is ready. You can return to your research workspace."
                  : recovery
                    ? `If an account exists for ${email}, you’ll receive a link to reset your password shortly.`
                    : `If confirmation is required, we’ve sent instructions to ${email}. Follow the link to finish setting up your account.`}
              </p>
              {!reset && (
                <div className="auth-mail-note">
                  Can’t find the email? Check your spam folder and make sure you
                  entered the right address.
                </div>
              )}
              <button
                className="auth-submit"
                onClick={() => navigate(reset ? "/" : "/login")}
              >
                {reset ? "Back to workspace" : "Back to log in"}
                <ArrowRight size={16} />
              </button>
              {!reset && (
                <button
                  className="auth-text-button"
                  onClick={() => {
                    setSuccess(false);
                    setError("");
                  }}
                >
                  Use a different email
                </button>
              )}
            </div>
          ) : (
            <>
              <span className="auth-state-icon">
                {recovery || reset ? (
                  <Mail size={22} />
                ) : (
                  <FlaskConical size={23} />
                )}
              </span>
              <span className="eyebrow">
                {signup
                  ? "START SOMETHING WORTH EXPLORING"
                  : recovery || reset
                    ? "ACCOUNT RECOVERY"
                    : "YOUR NEXT DISCOVERY AWAITS"}
              </span>
              <h2>{title}</h2>
              <p className="auth-description">
                {signup
                  ? "Create your Fieldwork account and start asking better questions."
                  : recovery
                    ? "Enter your email and we’ll send you a password reset link."
                    : reset
                      ? "Choose a strong password to secure your account."
                      : "Log in to your Fieldwork account."}
              </p>
              {resetUnavailable ? (
                <div className="auth-expired">
                  <p>
                    Open the password reset link from your email to continue. If
                    the link has expired, request a new one.
                  </p>
                  <a
                    href="/forgot-password"
                    onClick={(e) => link(e, "/forgot-password")}
                  >
                    Request a new link <ArrowRight size={15} />
                  </a>
                </div>
              ) : (
                <form onSubmit={submit}>
                  <fieldset disabled={busy || !ready}>
                    {signup && (
                      <label className="auth-field">
                        Full name
                        <input
                          name="name"
                          autoComplete="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Your full name"
                          required
                          maxLength={100}
                        />
                      </label>
                    )}
                    {!reset && (
                      <label className="auth-field">
                        Email address
                        <input
                          name="email"
                          type="email"
                          autoComplete="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          required
                          maxLength={254}
                        />
                      </label>
                    )}
                    {!recovery && (
                      <div className="auth-field">
                        <div className="password-label">
                          <label htmlFor="auth-password">
                            {reset ? "New password" : "Password"}
                          </label>
                          {!signup && !reset && (
                            <a
                              href="/forgot-password"
                              onClick={(e) => link(e, "/forgot-password")}
                            >
                              Forgot password?
                            </a>
                          )}
                        </div>
                        <div className="password-input">
                          <input
                            id="auth-password"
                            name="password"
                            type={show ? "text" : "password"}
                            autoComplete={
                              signup || reset
                                ? "new-password"
                                : "current-password"
                            }
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={
                              signup || reset
                                ? "Create a password"
                                : "Enter your password"
                            }
                            required
                            minLength={signup || reset ? 8 : undefined}
                            maxLength={128}
                            aria-describedby={
                              signup || reset ? "password-hint" : undefined
                            }
                          />
                          <button
                            type="button"
                            aria-label={
                              show ? "Hide password" : "Show password"
                            }
                            aria-pressed={show}
                            onClick={() => setShow(!show)}
                          >
                            {show ? <EyeOff size={17} /> : <Eye size={17} />}
                          </button>
                        </div>
                        {(signup || reset) && (
                          <small id="password-hint">
                            Use at least 8 characters.
                          </small>
                        )}
                      </div>
                    )}
                    {reset && (
                      <label className="auth-field">
                        Confirm new password
                        <input
                          type={show ? "text" : "password"}
                          autoComplete="new-password"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          placeholder="Re-enter your new password"
                          required
                          minLength={8}
                          maxLength={128}
                        />
                      </label>
                    )}
                    {error && (
                      <div className="auth-error" role="alert">
                        {error}
                      </div>
                    )}
                    <button
                      className="auth-submit"
                      type="submit"
                      disabled={busy || !ready}
                    >
                      {busy ? (
                        <>
                          <LoaderCircle className="auth-spinner" size={17} />
                          {recovery
                            ? "Sending link…"
                            : reset
                              ? "Updating password…"
                              : signup
                                ? "Creating account…"
                                : "Logging in…"}
                        </>
                      ) : (
                        <>
                          {recovery
                            ? "Send reset link"
                            : reset
                              ? "Update password"
                              : signup
                                ? "Create account"
                                : "Log in"}
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </fieldset>
                </form>
              )}
              {recovery || reset ? (
                <a
                  className="auth-back"
                  href="/login"
                  onClick={(e) => link(e, "/login")}
                >
                  <ArrowLeft size={14} /> Back to log in
                </a>
              ) : (
                <>
                  <div className="auth-divider">
                    <span>OR TAKE A LOOK AROUND</span>
                  </div>
                  <a
                    className="auth-preview"
                    href="/"
                    onClick={(e) => link(e, "/")}
                  >
                    Explore the workspace preview <ArrowRight size={15} />
                  </a>
                  <p className="auth-local-note">
                    Research drafts currently stay on this device.
                  </p>
                </>
              )}
            </>
          )}
          <div className="auth-form-footer">
            <span /> A little more context. A lot more clarity.
          </div>
        </div>
        <footer className="auth-bottom">
          <span>© {new Date().getFullYear()} Fieldwork</span>
          <span>Built for curious minds.</span>
        </footer>
      </section>
    </div>
  );
}
function ArrowUp() {
  return <ArrowRight size={12} style={{ transform: "rotate(-35deg)" }} />;
}
