export class RunStopped extends Error {}
export class PermanentError extends Error {}
export class ModelOutputError extends Error {}
export function retryable(error: unknown) {
  if (error instanceof PermanentError || error instanceof RunStopped)
    return false;
  if (
    error instanceof ModelOutputError ||
    (error as { code?: string })?.code === "json_validate_failed"
  )
    return true;
  const code = Number(
    (error as { status?: number; statusCode?: number })?.status ??
      (error as { statusCode?: number })?.statusCode,
  );
  return !code || code === 408 || code === 429 || code >= 500;
}
export function publicError(error: unknown) {
  if (error instanceof PermanentError) return error.message;
  if (
    error instanceof ModelOutputError ||
    (error as { code?: string })?.code === "json_validate_failed"
  )
    return "The model could not produce valid research data. Please retry this research.";
  return "A research provider is unavailable. Please try a new run later.";
}
