import { searchWeb, extractWeb } from "../src/services/search.service.js";

async function main() {
  const search = await searchWeb("Exa search API official documentation", 2);
  if (!search.results.length) throw new Error("Search returned no sources");
  console.log(
    JSON.stringify({
      stage: "search",
      results: search.results.length,
      withHighlights: search.results.filter((r) => r.highlights?.length).length,
    }),
  );
  const extraction = await extractWeb([search.results[0].url]);
  if (!extraction.results.some((r) => r.highlights?.length))
    throw new Error("Extraction returned no highlights");
  console.log(
    JSON.stringify({
      stage: "extract",
      results: extraction.results.length,
      withHighlights: extraction.results.filter((r) => r.highlights?.length)
        .length,
    }),
  );
}
main().catch(() => {
  console.error(
    "Exa smoke test failed. Check the API key, provider availability, and account credits.",
  );
  process.exitCode = 1;
});
