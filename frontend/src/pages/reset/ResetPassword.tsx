import { AuthForm } from "../../components/AuthForm";
import type { AuthPageProps } from "../../types/auth";
export const ResetPassword = (props: AuthPageProps) => (
  <AuthForm {...props} page="/reset-password" />
);
