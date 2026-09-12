import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { authAction } from "../lib/authApi";
import type { AuthPage, AuthPageProps } from "../types/auth";

export const useAuthForm = ({
  page,
  navigate,
  session,
  ready,
}: AuthPageProps & {
  page: AuthPage;
}) => {
  const signup = page === "/signup";
  const recovery = page === "/forgot-password";
  const reset = page === "/reset-password";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() =>
    new URLSearchParams(window.location.search).has("error") ||
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    setError("");

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
        await authAction("recover", { email: email.trim() });

        setSuccess(true);
      } else if (reset) {
        await authAction("password", { password });

        setPassword("");
        setConfirm("");
        setSuccess(true);
      } else if (signup) {
        const data = await authAction("signup", {
          email: email.trim(),
          password,
          name: name.trim(),
        });

        setPassword("");

        if (data.session) {
          navigate("/");
        } else {
          setSuccess(true);
        }
      } else {
        await authAction("login", { email: email.trim(), password });

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
  };

  const link = (event: React.MouseEvent<HTMLAnchorElement>, to: string) => {
    event.preventDefault();
    if (!busy) navigate(to);
  };

  const resetUnavailable = reset && ready && !session;

  return {
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
  };
};
