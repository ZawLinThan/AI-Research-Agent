import type { Analysis, ResearchPlan } from "../zodSchema/research.schema.js";
import type {
  Checkpoint,
  ReportLayout,
  ResearchStatus,
  Source,
} from "./research.js";

export type RunRecord = {
  id: string;
  question: string;
  depth: string;
  scope: string;
  checkpoint: Checkpoint;
  startedAt: Date;
};

export type PipelineDeps = {
  save: (
    state: Checkpoint,
    status: ResearchStatus,
    progress: number,
    report?: string,
  ) => Promise<void>;
  check: () => Promise<void>;
  plan: (
    question: string,
    depth: string,
    scope: string,
    signal: AbortSignal,
  ) => Promise<ResearchPlan>;
  search: (
    searches: Record<string, Source[]>,
    question: string,
    plan: ResearchPlan,
    scope: string,
    signal: AbortSignal,
    checkpoint: () => Promise<void>,
  ) => Promise<Record<string, Source[]>>;
  analyze: (
    question: string,
    sources: Source[],
    signal: AbortSignal,
  ) => Promise<Analysis>;
  analyzeQueries?: (
    question: string,
    state: Checkpoint,
    signal: AbortSignal,
    checkpoint: () => Promise<void>,
  ) => Promise<Analysis>;
  verify: (
    question: string,
    analysis: Analysis,
    sources: Source[],
    signal: AbortSignal,
  ) => Promise<Analysis>;
  present?: (
    question: string,
    analysis: Analysis,
    signal: AbortSignal,
  ) => Promise<ReportLayout>;
};
