// UTF-8 budgets match the provider scheduler's estimator without splitting a
// Unicode character or changing the original substring used for quote checks.
export function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0,
    end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
}
