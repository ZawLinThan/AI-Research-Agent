import { truncateUtf8 } from "../lib/textBudget.js";
import { z } from "zod";
import { structured } from "../config/openRouterAI.js";
import type { Source } from "../types/research.js";

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .match(/[\p{L}\p{N}%]+/gu) ?? [];

const text = (s: Source) => s.highlights.join(" ");

// Avoid treating different measurements or opposing conclusions as copies.
export function compatibleFacts(a: string, b: string) {
  const signature = (value: string) =>
    [
      ...new Set(
        value
          .toLowerCase()
          .match(
            /\b\d+(?:[.,]\d+)*%?|\b(?:not|never|no|increase|decrease|higher|lower|rose|fell)\b/g,
          ) ?? [],
      ),
    ]
      .sort()
      .join("|");

  return signature(a) === signature(b);
}

export function nearIdentical(a: Source, b: Source) {
  const left = words(text(a)),
    right = words(text(b));

  if (
    Math.min(left.length, right.length) < 20 ||
    !compatibleFacts(text(a), text(b))
  ) {
    return false;
  }

  const shingles = (tokens: string[]) =>
    new Set(
      tokens.slice(0, -3).map((_, i) => tokens.slice(i, i + 4).join(" ")),
    );
  const x = shingles(left),
    y = shingles(right);
  const common = [...x].filter((v) => y.has(v)).length;

  return common / (x.size + y.size - common) >= 0.9;
}

export async function deduplicateSources(
  sources: Source[],
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const aliases: Record<string, string> = {};
  const representatives: Source[] = [];

  for (const source of sources) {
    const duplicate = representatives.find((existing) =>
      nearIdentical(existing, source),
    );

    if (duplicate) {
      aliases[source.id] = duplicate.id;
    } else {
      representatives.push(source);
    }
  }

  // Comparing bounded profiles in one pass lets duplicates across different
  // queries be detected, rather than only comparing each query in isolation.
  if (representatives.length > 1) {
    const perSource = Math.max(40, Math.floor(8500 / representatives.length));
    const result = await structured(
      'Identify semantically duplicate search results: substantially the same information or syndicated/reworded copies. Return {"duplicates":[{"sourceId":"redundant ID","keepSourceId":"representative ID"}]}. Compare ALL supplied profiles. Do not merge merely related topics, independent evidence, different entities, dates, populations, measurements, or opposing conclusions. If a profile is too short to establish equivalence, keep both. Choose one representative per duplicate group. Never invent IDs, create chains/cycles, or drop unique evidence.',
      {
        sources: representatives.map((s) => ({
          sourceId: s.id,
          profile: truncateUtf8(
            `${truncateUtf8(s.title, Math.min(40, Math.floor(perSource / 3)))}: ${text(s)}`,
            perSource,
          ),
        })),
      },
      z.object({
        duplicates: z
          .array(z.object({ sourceId: z.string(), keepSourceId: z.string() }))
          .max(100),
      }),
      signal,
      1400,
    );
    const byId = new Map(representatives.map((s) => [s.id, s]));

    for (const pair of result.duplicates) {
      const a = byId.get(pair.sourceId),
        b = byId.get(pair.keepSourceId);

      if (!a || !b || a.id === b.id || aliases[a.id] || aliases[b.id]) {
        continue;
      }

      if (Object.values(aliases).includes(a.id)) {
        continue;
      }

      if (compatibleFacts(text(a), text(b))) {
        aliases[a.id] = b.id;
      }
    }
  }

  // Resolve near-copy aliases whose representative was later deduplicated.
  for (const id of Object.keys(aliases)) {
    let target = aliases[id];
    const seen = new Set([id]);

    while (aliases[target] && !seen.has(target)) {
      seen.add(target);
      target = aliases[target];
    }

    aliases[id] = target;
  }

  return aliases;
}
