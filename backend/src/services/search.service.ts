import "dotenv/config";
import Exa from "exa-js";
import { z } from "zod";
import { PermanentError } from "../lib/errors.js";
import axios from "axios";

const querySchema = z.string().trim().min(1).max(5000);
function getClient() {
  if (!process.env.EXA_API_KEY)
    throw new PermanentError("Web search is not configured.");
  return new Exa(process.env.EXA_API_KEY);
}
/** Standalone SDK retrieval, also used by the Exa smoke test. */
export async function searchWeb(query: string, numResults = 5) {
  return getClient().search(querySchema.parse(query), {
    type: "auto",
    numResults: z.number().int().min(1).max(10).parse(numResults),
    contents: { highlights: true },
  });
}
export async function extractWeb(urls: string[]) {
  const checked = z
    .array(
      z
        .string()
        .url()
        .refine((v) => {
          const u = new URL(v);
          return (
            ["http:", "https:"].includes(u.protocol) &&
            !u.username &&
            !u.password
          );
        }),
    )
    .min(1)
    .max(10)
    .parse(urls);
  return getClient().getContents([...new Set(checked)], { highlights: true });
}
/** Fetch directly so an aborted/cancelled worker can cancel the actual HTTP request. */
export async function searchWithSignal(
  query: string,
  scope: string,
  signal: AbortSignal,
) {
  const response = await axios.post("https://api.exa.ai/search",
    {
      query: querySchema.parse(query),
      type: "auto",
      numResults: 5,
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
    }, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.EXA_API_KEY || "",
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });

  if (!(response.status >= 200 && response.status < 300)) {
    const error = new Error("Search provider request failed") as Error & {
      status: number;
    };
    error.status = response.status;
    throw error;
  }
  
  return z
    .object({
      results: z.array(
        z.object({
          url: z.string().url(),
          title: z.string().nullish(),
          highlights: z.array(z.string()).optional(),
        }),
      ),
    })
    .parse(await response.data);
}
