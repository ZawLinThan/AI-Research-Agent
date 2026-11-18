import { AuthForm } from "../components/AuthForm";
import type { AuthPageProps } from "../types/auth";
export const Recover = (props: AuthPageProps) => (
  <AuthForm {...props} page="/forgot-password" />
);
