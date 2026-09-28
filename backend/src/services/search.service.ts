import { normalizeSearchReview } from "../lib/modelOutputNormalization.js";
import "dotenv/config";
import { z } from "zod";
import axios from "axios";
import {
  SearchReview,
  searchReviewSchema,
  sourcesSchema,
} from "../zodSchema/search.schema.js";
import { Source } from "../types/research.js";
import { structured } from "../config/openRouterAI.js";
import { ResearchPlan } from "../zodSchema/research.schema.js";
import { QuerySearchSummary } from "../types/search.js";

import { scheduleProviderRequest } from "../lib/providerRateLimit.js";
import { beforeProviderCall } from "../lib/providerCalls.js";
import { exaClient, requireExaKey } from "../config/exa.js";

const querySchema = z.string().trim().min(1).max(5000);

export const search = async (
  query: string,
  scope: string,
  signal: AbortSignal,
): Promise<Source[]> => {
  const response = await scheduleProviderRequest("exa", 0, signal, async () => {
    await beforeProviderCall();
    return axios.post(
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
          "x-api-key": requireExaKey(),
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
      },
    );
  });

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

const selectReviewSources = (
  sources: Source[],
  limit = 4,
) => {
  const selected: Source[] = [];
  const seenDomains = new Set<string>();

  // First prefer different domains
  for (const source of sources) {
    const domain = new URL(source.url).hostname;

    if (!seenDomains.has(domain)) {
      selected.push(source);
      seenDomains.add(domain);
    }

    if (selected.length === limit) {
      return selected;
    }
  }

  // Fill remaining slots by rank
  for (const source of sources) {
    if (!selected.includes(source)) {
      selected.push(source);
    }

    if (selected.length === limit) {
      break;
    }
  }

  return selected;
};

const loggingSource = (source: Source) => {
  console.log("   title: ", source.title)
  console.log("   url: ", source.url)
  console.log("   highlights: ", source.highlights
    .slice(0, 1)
    .map((text) => text.slice(0, 250)),)
}

export const prepareSearchReview = (
  searches: Record<string, Source[]>,
): QuerySearchSummary[] => {
  const summaries: QuerySearchSummary[] = [];
  const entries = Object.entries(searches).slice(-10);
  const perQuery = Math.floor(10000 / Math.max(entries.length, 1)) - 1;

  console.log("Search Summary for review is :");

  for (const [query, sources] of entries) {
    console.log("query: ", query);
    console.log("resultCount: ", sources.length)
    console.log("sources: ")
    sources.map(source => (
      loggingSource(source)
    ))
    const summary: QuerySearchSummary = {
      query: query.slice(0, 300),
      resultCount: sources.length,
      topResults: selectReviewSources(sources).map((source) => ({
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

  console.log("Reviewing search");

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

    - Do not mark the search sufficient merely because some relevant
      high-quality evidence was found.
    - Require evidence covering the major entity categories implied
      by the question.
    - Require multiple independent sources when making comparative
      claims across organizations.
    - A single source or a single narrow comparison is not sufficient
      for a broad ranking question.
    - Check whether the retrieved evidence allows comparison using
      meaningful leadership criteria such as market position,
      adoption, revenue, valuation, research influence, infrastructure,
      or other domain-appropriate measures.

    Output contract:
    - Return ALL these fields, including reason:
      {"sufficient":false,"relevanceScore":0.5,"coverageScore":0.5,"sourceQualityScore":0.5,"missingEvidence":[],"weakAreas":[],"followUpQueries":[],"reason":"Brief explanation of the decision."}
    - The example illustrates the structure; determine the values from the supplied evidence.
    - Scores are numbers between 0 and 1, not percentages or strings.
    - missingEvidence and weakAreas each contain at most 3 strings of at most 200 characters.
    - followUpQueries contains at most 2 distinct queries, each 3–300 characters.
    - followUpQueries must queries that answer the missing areas of the question. 
    - followUpQueries must not be questions. They must be concise followUp queries
    - Return no follow-up queries when sufficient=true; otherwise target meaningful gaps and avoid already searched queries.
    - reason is required and must contain 1–400 characters. Keep the entire response concise.

    When generating follow-up queries:

    - Do not generate queries that are semantically equivalent
      to existing or previously executed queries.
    - A query is redundant if it is likely to retrieve substantially
      the same result set even if wording differs.
    - Prefer a different missing dimension rather than paraphrasing
      an existing query.
    `,
    {
      question,
      researchPlan: plan,
      searches: searchSummary,
      executedQueries: Object.keys(searches),
    },
    searchReviewSchema,
    signal,
    1400,
    normalizeSearchReview,
  );
};

export const searchWeb = async (query: string, numResults = 5) => {
  requireExaKey();
  const checked = querySchema.parse(query);
  const count = z.number().int().min(1).max(10).parse(numResults);
  return exaClient.search(checked, {
    type: "auto",
    numResults: count,
    contents: { highlights: true },
  });
};

export const extractWeb = async (urls: string[]) => {
  requireExaKey();
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
  return exaClient.getContents([...new Set(checked)], { highlights: true });
};
