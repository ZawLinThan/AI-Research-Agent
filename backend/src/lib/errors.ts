export class RunStopped extends Error {}

export class PermanentError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "PermanentError";
  }
}

export type ModelValidationIssue = { path: string; code: string };

export class ModelOutputError extends Error {
  readonly provider = "openrouter";
  readonly code = "json_validate_failed";
  correctionAttempted = false;
  constructor(
    message = "The model returned invalid research data.",
    readonly kind:
      | "truncated"
      | "invalid_json"
      | "schema_validation"
      | "provider_schema_validation" = "schema_validation",
    readonly issues: ModelValidationIssue[] = [],
    public status?: number,
  ) {
    super(message);
    this.name = "ModelOutputError";
  }
}

export const modelValidationDetails = (error: unknown) =>
  error instanceof ModelOutputError
    ? {
        kind: error.kind,
        issues: error.issues,
        correctionAttempted: error.correctionAttempted,
      }
    : undefined;

export function retryable(error: unknown) {
  if (error instanceof PermanentError || error instanceof RunStopped) {
    return false;
  }

  if (
    error instanceof ModelOutputError ||
    (error as { code?: string })?.code === "json_validate_failed"
  ) {
    return true;
  }

  const code = Number(
    (error as { status?: number; statusCode?: number })?.status ??
      (error as { statusCode?: number })?.statusCode,
  );

  return !code || code === 408 || code === 429 || code >= 500;
}

export function publicError(error: unknown) {
  const details = error as {
    status?: number;
    response?: { status?: number };
    provider?: string;
  };
  if ((details?.status ?? details?.response?.status) === 429) {
    return `${details.provider === "openrouter" ? "The AI provider" : details.provider === "exa" ? "The search provider" : "A research provider"} is rate-limiting requests. Please try again after its allowance resets.`;
  }

  if (error instanceof PermanentError) {
    return error.message;
  }

  if (
    error instanceof ModelOutputError ||
    (error as { code?: string })?.code === "json_validate_failed"
  ) {
    return "The model could not produce valid research data. Please retry this research.";
  }

  return "A research provider is unavailable. Please try a new run later.";
}
