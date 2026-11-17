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

const shingleSet = (value: string) => {
  const tokens = words(value);
  return new Set(
    tokens.slice(0, -3).map((_, i) => tokens.slice(i, i + 4).join(" ")),
  );
};

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const shingle of a) if (b.has(shingle)) common++;
  return common / (a.size + b.size - common);
};

// Avoid treating different measurements or opposing conclusions as copies.
export function compatibleFacts(a: string, b: string) {
  const signature = (value: string) =>
    [
      ...new Set(
        value
          .toLowerCase()
          .replace(/\b\d+(?:[.,]\d+)*%?/g, "<num>")
          .match(
            /<num>|\b(?:not|never|no|increase|decrease|higher|lower|rose|fell)\b/g,
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

  return jaccard(shingleSet(text(a)), shingleSet(text(b))) >= 0.9;
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

  // Only compare representatives with a plausible overlapping passage.
  const shingles = representatives.map((source) => shingleSet(text(source)));
  const candidatePairs: [number, number][] = [];
  for (let i = 0; i < representatives.length; i++) {
    for (let j = i + 1; j < representatives.length; j++) {
      if (jaccard(shingles[i], shingles[j]) >= 0.3) {
        candidatePairs.push([i, j]);
      }
    }
  }

  const byId = new Map(representatives.map((source) => [source.id, source]));
  const batches: Source[][] = [];
  for (const [left, right] of candidatePairs) {
    const existing = batches.find(
      (batch) =>
        batch.includes(representatives[left]) &&
        batch.includes(representatives[right]),
    );
    if (existing) continue;
    const batch = batches.find(
      (items) =>
        new Set([...items, representatives[left], representatives[right]])
          .size <= 40,
    );
    if (batch) {
      if (!batch.includes(representatives[left]))
        batch.push(representatives[left]);
      if (!batch.includes(representatives[right]))
        batch.push(representatives[right]);
    } else {
      batches.push([representatives[left], representatives[right]]);
    }
  }

  for (const batch of batches) {
    const perSource = Math.max(40, Math.floor(8500 / batch.length));
    const result = await structured(
      'Identify semantically duplicate search results: substantially the same information or syndicated/reworded copies. Return {"duplicates":[{"sourceId":"redundant ID","keepSourceId":"representative ID"}]}. Compare supplied profiles. Do not merge merely related topics, independent evidence, different entities, dates, populations, measurements, or opposing conclusions. If a profile is too short to establish equivalence, keep both. Choose one representative per duplicate group. Never invent IDs, create chains/cycles, or drop unique evidence.',
      {
        sources: batch.map((source) => ({
          sourceId: source.id,
          profile: truncateUtf8(
            `${truncateUtf8(source.title, Math.min(40, Math.floor(perSource / 3)))}: ${text(source)}`,
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
    const batchIds = new Set(batch.map((source) => source.id));

    for (const pair of result.duplicates) {
      const a = byId.get(pair.sourceId),
        b = byId.get(pair.keepSourceId);
      if (
        !a ||
        !b ||
        a.id === b.id ||
        !batchIds.has(a.id) ||
        !batchIds.has(b.id) ||
        aliases[a.id] ||
        aliases[b.id]
      )
        continue;
      if (Object.values(aliases).includes(a.id)) continue;
      if (compatibleFacts(text(a), text(b))) aliases[a.id] = b.id;
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
