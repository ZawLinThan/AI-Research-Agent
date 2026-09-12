import { AuthForm } from "../../components/AuthForm";
import type { AuthPageProps } from "../../types/auth";
export const Login = (props: AuthPageProps) => (
  <AuthForm {...props} page="/login" />
);
