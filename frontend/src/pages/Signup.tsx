import { AuthForm } from "../components/AuthForm";
import type { AuthPageProps } from "../types/auth";
export const Signup = (props: AuthPageProps) => (
  <AuthForm {...props} page="/signup" />
);
