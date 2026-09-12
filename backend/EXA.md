# Exa retrieval

The server uses `exa-js` and the existing `EXA_API_KEY` environment variable.
Keep this key server-side; never prefix it with `VITE_`.

```ts
import { searchWeb, extractWeb } from "./src/services/search.service.js";

const sources = await searchWeb("Your research question");
// sources.results contains titles, URLs, and highlights.
const excerpts = await extractWeb(
  sources.results.slice(0, 3).map((r) => r.url),
);
// Preserve and inspect excerpts.statuses for per-URL extraction failures.
```

Search uses `type: "auto"`, defaults to 5 results, and requests only highlights.
Search counts and extraction batches are limited to 10. Known URLs must be HTTP(S)
without embedded credentials. Provider errors propagate to the caller; the service
does not convert a failed search into an empty successful result. Source excerpts
are untrusted evidence, not agent instructions.

Run from the project root:

```sh
node --import tsx --test backend/src/services/__tests__/search.service.test.ts
node --import tsx backend/scripts/exa-smoke.ts
```

The smoke test makes a two-result search and extracts one returned URL, consuming
Exa credits. Both stages were verified with live highlights during setup.

Retrieval is connected to the BullMQ worker, persisted evidence, verified reports,
and authenticated research API. See [RESEARCH.md](RESEARCH.md) for setup, limits,
and end-to-end verification.

Canonical reference: https://docs.exa.ai/reference/search-api-guide-for-coding-agents

Guide correction: the pasted `/contents` text-options table uses `max_characters`;
JavaScript and JSON use `maxCharacters`. This integration requests highlights and
is unaffected by that example typo.
