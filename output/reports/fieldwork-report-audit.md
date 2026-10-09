# Audit of fieldwork-research.md

Input: `/Users/zawlinthan/Downloads/fieldwork-research.md`.

## Findings

1. **Incorrect legal entity.** The 104th-place, $1.824 billion entry belongs to Bank of America California. The same March 31, 2025 source ranks Bank of America second at $193.808 billion. [Verify the source rows](https://www.usbanklocations.com/bank-rank/tier-1-core-risk-based-capital.html?d=2025-03-31).
2. **Metric mismatch.** Absolute Tier 1 capital, Tier 1 leverage ratios, CET1 ratios, and Basel III compliance are treated as interchangeable evidence. They do not measure the same thing.
3. **Incomplete comparison.** There is no substantive Wells Fargo finding, no balanced operating comparison, and no aligned financial table. Three vague capital bullets do not answer the broad question.
4. **Broken prose.** The first finding ends at “firm inv”; another limitation ends at “interpret re”. These fragments should be rejected or rewritten from complete evidence, not published.
5. **Unsupported summary.** “Strong” and regulatory compliance are asserted without numerical benchmarks or demonstrated requirements. The summary's relative ranking inherits the incorrect entity attribution.
6. **False contradiction.** Facts about different banks do not contradict one another. The competing-evidence section names a topic but supplies no opposing claims about the same entity, period and measure.
7. **Unprocessed research notes.** Around thirty limitations overwhelm three findings. Repeated requests, internal source IDs, speculative numeric comparisons, and context-retrieval status leak into the report.
8. **Unclear time frame.** March and third-quarter 2025 material is mixed with questions about 2024 and year-end 2025. Retrieval timestamps do not establish the dates of the underlying observations.

## Pipeline changes

- Pass source titles and URLs into claim verification.
- Apply explicit legal-entity, table-header, reporting-period, metric and complete-sentence checks during per-query analysis and verification.
- Allocate the full per-source excerpt budget when only one highlight is available.
- Independently review proposed contradictions and show the actual opposing claims for those retained.
- Extend final review to assess whether a broad comparison substantively covers all requested entities and multiple relevant dimensions.
- Consolidate long limitation lists into at most six reader-facing items, preserving original gaps in the analysis checkpoint.

These checks use model judgments; they reduce failure modes but do not prove factual accuracy. Mocked regression tests validate request context, filtering, index remapping, coverage rejection handling, and limitation rendering. They do not establish the live model's accuracy on this report.

The corrected companion report uses directly checked sources and an explicit FY2025 scope. The original download and the saved application report are not overwritten.
