import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  FlaskConical,
  LoaderCircle,
  Mail,
} from "lucide-react";
import "../auth.css";
import { useAuthForm } from "../hooks/useAuthForm";
import type { AuthPage, AuthPageProps } from "../types/auth";
import { AuthStory } from "./AuthStory";
export const AuthForm = ({
  page,
  navigate,
  session,
  ready,
}: AuthPageProps & {
  page: AuthPage;
}) => {
  const {
    signup,
    recovery,
    reset,
    email,
    setEmail,
    name,
    setName,
    password,
    setPassword,
    confirm,
    setConfirm,
    show,
    setShow,
    busy,
    error,
    setError,
    success,
    setSuccess,
    title,
    submit,
    link,
    resetUnavailable,
  } = useAuthForm({ page, navigate, session, ready });

  return (
    <div className="auth-layout">
      <AuthStory link={link} />
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
                  ? "Your new password is ready. Log in again to return to your research."
                  : recovery
                    ? `If an account exists for ${email}, you’ll receive a link to reset your password shortly.`
                    : `If confirmation is required, we’ve sent instructions to ${email}. Follow the link to finish setting up your account.`}
              </p>
              {!reset && (
                <div className="auth-mail-note">
                  Can’t find the email? Check your spam folder and make sure you
                  entered the right address. Open the link in this browser.
                </div>
              )}
              <button
                className="auth-submit"
                onClick={() => navigate("/login")}
              >
                Back to log in
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
                    Sign in to save and run research in your account.
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
};
export const ArrowUp = () => {
  return <ArrowRight size={12} style={{ transform: "rotate(-35deg)" }} />;
};
