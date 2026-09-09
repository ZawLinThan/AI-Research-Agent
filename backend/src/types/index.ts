export type ResearchStatus =
  | "pending"
  | "planning"
  | "searching"
  | "analyzing"
  | "generating_report"
  | "completed"
  | "failed";

export interface ResearchPlan {
  queries: string[];
}
