import { requireExaKey } from "../config/exa.js";
import axios from "axios";
import { z } from "zod";
import { beforeProviderCall } from "../lib/providerCalls.js";
import { scheduleProviderRequest } from "../lib/providerRateLimit.js";
import { canonicalUrl } from "./evidence.service.js";
import type { Source } from "../types/research.js";

// Retrieve the source body, not just another search highlight. Bound page size;
// the query summarizer receives relevant contiguous passages from this body.
export async function fetchSourceContext(
  source: Source,
  signal: AbortSignal,
): Promise<string> {
  const response = await scheduleProviderRequest("exa", 0, signal, async () => {
    await beforeProviderCall();

    return axios.post(
      "https://api.exa.ai/contents",
      {
        ids: [canonicalUrl(source.url)],
        text: { maxCharacters: 15000 },
      },
      {
        headers: { "x-api-key": requireExaKey() },
        signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
      },
    );
  });

  const result = z
    .object({
      results: z.array(
        z.object({ url: z.string(), text: z.string().optional() }),
      ),
    })
    .parse(response.data);

  return (
    result.results.find((r) => canonicalUrl(r.url) === canonicalUrl(source.url))
      ?.text ?? ""
  );
}

export function contextPassages(
  document: string,
  query: string,
  reason: string,
  limit = 5000,
): string[] {
  if (document.length <= limit) {
    return document ? [document] : [];
  }

  const terms = [
    ...new Set(
      `${query} ${reason}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
    ),
  ];
  const windows = [];

  for (let start = 0; start < document.length; start += 1000) {
    const text = document.slice(start, start + 1400);
    const lower = text.toLowerCase();

    windows.push({
      start,
      text,
      score: terms.filter((term) => lower.includes(term)).length,
    });
  }

  const selected = windows
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, 3)
    .sort((a, b) => a.start - b.start);

  return selected.map((w) =>
    w.text.slice(0, Math.floor(limit / selected.length)),
  );
}
