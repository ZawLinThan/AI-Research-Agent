import "dotenv/config";
import { z } from "zod";
import axios from "axios";
import {
  SearchReview,
  searchReviewSchema,
  sourcesSchema,
} from "../zodSchema/search.schema.js";
import { Source } from "../types/research.js";
import { structured } from "../config/groqAI.js";
import { ResearchPlan } from "../zodSchema/research.schema.js";
import { QuerySearchSummary } from "../types/search.js";

import { beforeProviderCall } from "../lib/providerCalls.js";

const querySchema = z.string().trim().min(1).max(5000);

export const search = async (
  query: string,
  scope: string,
  signal: AbortSignal,
): Promise<Source[]> => {
  await beforeProviderCall();
  const response = await axios.post(
    "https://api.exa.ai/search",
    {
      query: querySchema.parse(query),
      type: "auto",
      numResults: 10,
      contents: { highlights: true },
      ...(scope === "Academic"
        ? {
            includeDomains: [
              "arxiv.org",
              "pubmed.ncbi.nlm.nih.gov",
              "pmc.ncbi.nlm.nih.gov",
              "nature.com",
              "science.org",
              "acm.org",
              "ieee.org",
            ],
          }
        : {}),
    },
    {
      headers: {
        "x-api-key": process.env.EXA_API_KEY,
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    },
  );

  // Exa only returns 200 for successful requests
  if (response.status !== 200) {
    const error = new Error("Search provider request failed") as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }

  // sources per query
  const sources = sourcesSchema.parse(await response.data);

  return sources.results.map((r) => ({
    id: r.url,
    url: r.url,
    title: r.title || r.url,
    highlights: r.highlights || [],
    queries: [query],
    retrievedAt: new Date().toISOString(),
    logo: new URL(r.url).origin + "/favicon.ico",
  }));
};

export const prepareSearchReview = (
  searches: Record<string, Source[]>,
): QuerySearchSummary[] => {
  const summaries: QuerySearchSummary[] = [];
  const entries = Object.entries(searches).slice(-10);
  const perQuery = Math.floor(10000 / Math.max(entries.length, 1)) - 1;

  for (const [query, sources] of entries) {
    const summary: QuerySearchSummary = {
      query: query.slice(0, 300),
      resultCount: sources.length,
      topResults: sources.slice(0, 2).map((source) => ({
        title: source.title.slice(0, 100),
        url: source.url.slice(0, 180),
        highlights: source.highlights
          .slice(0, 1)
          .map((text) => text.slice(0, 250)),
      })),
    };
    while (
      JSON.stringify(summary).length > perQuery &&
      summary.topResults.length
    )
      summary.topResults.pop();
    summaries.push(summary);
  }
  return summaries;
};

export const reviewSearch = async (
  question: string,
  plan: ResearchPlan,
  searches: Record<string, Source[]>,
  signal: AbortSignal,
): Promise<SearchReview> => {
  const currentDate = new Date().toISOString().split("T")[0];

  const searchSummary = prepareSearchReview(searches);

  return structured(
    `
    You are evaluating web search results for a research task.

    Current date: ${currentDate}

    Do NOT answer the user's research question.

    Your job is to determine whether the retrieved search results
    provide enough evidence to continue to the analysis stage.

    Evaluate:

    1. Relevance
    - Do the results directly relate to the user's question?

    2. Coverage
    - Do the search results cover the important dimensions
      of the research plan?
    - Identify meaningful gaps.

    3. Source quality
    - Prefer authoritative, primary, reputable,
      or domain-relevant sources.
    - Flag low-quality listicles, SEO-heavy pages,
      repetitive sources, or weak secondary sources.

    4. Diversity
    - Are different perspectives and source types represented?
    - Do not count duplicate or near-duplicate results
      as broad coverage.

    5. Freshness
    - For time-sensitive questions, determine whether
      the evidence is recent enough.

    Decision rules:

    - Set sufficient=true if the current evidence is good enough
      to continue to evidence extraction.
    - Do not require perfect coverage.
    - If evidence is insufficient, identify only the meaningful gaps.
    - Generate targeted follow-up queries only for those gaps.
    - Do not repeat queries already present in the search results.
    - Return an empty followUpQueries array if sufficient=true.
    - Return ALL these fields, including reason:
      {"sufficient":true,"relevanceScore":0.8,"coverageScore":0.8,"sourceQualityScore":0.8,"missingEvidence":[],"weakAreas":[],"followUpQueries":[],"reason":"Brief explanation of the decision."}
    - Scores must be between 0 and 1. Use at most 3 short missingEvidence and weakAreas entries.
    - Use at most 2 follow-up queries, each between 3 and 300 characters. Keep reason under 400 characters.
    - These are sampled excerpts, not full documents; describe uncertainty without assuming absent information is false.
    `,
    {
      question,
      researchPlan: plan,
      searches: searchSummary,
    },
    searchReviewSchema,
    signal,
  );
};

import Exa from "exa-js";
import { PermanentError } from "../lib/errors.js";
const exa = () => {
  if (!process.env.EXA_API_KEY)
    throw new PermanentError("Web search is not configured.");
  return new Exa(process.env.EXA_API_KEY);
};
export const searchWeb = async (query: string, numResults = 5) => {
  const checked = querySchema.parse(query);
  const count = z.number().int().min(1).max(10).parse(numResults);
  return exa().search(checked, {
    type: "auto",
    numResults: count,
    contents: { highlights: true },
  });
};
export const extractWeb = async (urls: string[]) => {
  const checked = z
    .array(
      z
        .string()
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
          );
        }),
    )
    .min(1)
    .max(10)
    .parse(urls);
  return exa().getContents([...new Set(checked)], { highlights: true });
};
