import type { EvidenceCheckpoint } from "../zodSchema/queryEvidence.schema.js";
import type {
  Analysis,
  ResearchInput,
  ResearchPlan,
} from "../zodSchema/research.schema";

export const statuses = [
  "pending",
  "planning",
  "awaiting_approval",
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
  queryIds?: string[];
  publishedAt?: string;
  sourceDomain?: string;
};

export type Checkpoint = {
  plan?: ResearchPlan;
  planningDraft?: ResearchPlan;
  planApproved?: boolean;
  highlightReport?: {
    summaries: Record<string, { summary: string }>;
    gaps?: string[];
    report?: string;
  };
  searches?: Record<string, Source[]>;
  sources?: Source[];
  searchComplete?: boolean;
  analysis?: Analysis;
  evidence?: EvidenceCheckpoint;
  followUpDone?: boolean;
  verified?: Analysis;
  reportLayout?: ReportLayout;
  calls?: number;
  evidenceRecords?: EvidenceRecord[];
  extractedSourceIds?: string[];
  evidencePipelineVersion?: number;
  evidenceRejections?: { sourceUrl: string; reason: string }[];
  reportClaims?: { text: string; evidenceIds: string[] }[];
  searchReview?: import("../zodSchema/search.schema.js").SearchReview;
};

export type ReportLayout = {
  reportVersion?: number;
  comparison?: {
    entities: string[];
    currentDate: string;
    rows: {
      metric: string;
      period: string;
      basis: string;
      cells: { entity: string; findingIndexes: number[] }[];
      sharedFindingIndexes: number[];
      coveredEntities?: string[];
    }[];
  };
  limitations?: string[];
  // Optional only for checkpoints created before synthesized summaries.
  summary?: string;
  summaryOmitted?: boolean;
  overview: number[];
  sections: { heading: string; summary?: string; findingIndexes: number[] }[];
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
  stages?: { stage: string; payload: unknown; updatedAt: string }[];
  researchPlan?: ResearchPlan | null;
};

export const terminal = (status: string) =>
  ["completed", "failed", "cancelled"].includes(status);

export type EvidenceRecord = {
  id: string;
  claim: string;
  entity?: string;
  metric?: string;
  period?: string;
  value?: string;
  basis?: string;
  sourceUrl: string;
  sourceTitle: string;
  publishedAt?: string;
  quote: string;
};
