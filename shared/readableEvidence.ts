// Presentation only: retain the original excerpts for exact citation checks.
export function readableEvidence(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    lsquo: "‘",
    rsquo: "’",
    ldquo: "“",
    rdquo: "”",
  };
  return value
    .replace(/\\[nrt]/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (!entity.startsWith("#"))
        return entities[entity.toLowerCase()] ?? match;
      const code =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    })
    .replace(/<\|[^>]*\|>/g, " ")
    .replace(/\[(?:start|end)\s+(?:of\s+)?(?:text|document|highlight)\]/gi, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[\d+\]/g, "$1")
    .replace(/\\([\\`*_{}\[\]()#+.!|>-])/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a ?? b)
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`+/g, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, " ")
    .replace(/\s*\|\s*/g, "; ")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
