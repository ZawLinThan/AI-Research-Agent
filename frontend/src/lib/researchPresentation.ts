export const done = (status: string) =>
  ["completed", "failed", "cancelled"].includes(status);
export const labels: Record<string, string> = {
  pending: "Queued",
  planning: "Planning",
  awaiting_approval: "Awaiting plan approval",
  searching: "Finding sources",
  analyzing: "Reviewing evidence",
  generating_report: "Verifying report",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
