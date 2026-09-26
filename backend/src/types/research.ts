import type {
  Analysis,
  ResearchInput,
  ResearchPlan,
} from "../zodSchema/research.schema";

export const statuses = [
  "pending",
  "planning",
  "searching",
  "analyzing",
  "generating_report",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ResearchStatus = (typeof statuses)[number];

export type Source = {
  id: string;
  url: string;
  title: string;
  highlights: string[];
  queries: string[];
  retrievedAt: string;
  logo?: string;
};

export type Checkpoint = {
  plan?: ResearchPlan;
  searches?: Record<string, Source[]>;
  sources?: Source[];
  searchComplete?: boolean;
  analysis?: Analysis;
  followUpDone?: boolean;
  verified?: Analysis;
  reportLayout?: ReportLayout;
  calls?: number;
};

export type ReportLayout = {
  overview: number[];
  sections: { heading: string; findingIndexes: number[] }[];
};

export type ResearchProject = {
  id: string;
  question: string;
  status: ResearchStatus;
  depth: ResearchInput["depth"];
  scope: ResearchInput["scope"];
  progress: number;
  report: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  sources?: Source[];
  researchPlan?: ResearchPlan | null;
};

export const terminal = (status: string) =>
  ["completed", "failed", "cancelled"].includes(status);
