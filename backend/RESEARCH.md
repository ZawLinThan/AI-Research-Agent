# Research pipeline

## Run locally

1. Configure the root `.env`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `OPENROUTER_API_KEY`, `EXA_API_KEY`. Optional: `OPENROUTER_MODEL` (default
   `nvidia/nemotron-3.5-lightning`), `REDIS_URL`, or `REDIS_HOST`, `REDIS_PORT`,
   `REDIS_PASSWORD`. Never expose provider secrets in Vite variables.
   Create an OpenRouter key at https://openrouter.ai/settings/keys. Groq keys cannot be reused.
   The model receives the output schema in its prompt; responses are validated locally
   with Zod and get one correction attempt. No unsupported `response_format` is sent.
   Nemotron structured calls disable reasoning to leave the completion budget for JSON.
   A truncated response gets one retry with twice the output allowance; Redis admission
   includes that larger allowance and continues to enforce the configured token limit.
2. Use the existing Redis service, or `docker compose -f compose.research.yml up -d`.
   Do not start a second Redis on port 6379. The provided configuration persists
   queue state in a volume with AOF and uses `noeviction`.
3. `npm run db:migrate` applies migrations from `backend/drizzle`.
4. In separate terminals: `npm run dev`, `npm run worker`, and
   `npm run dev --prefix frontend -- --host 127.0.0.1`.
5. Open http://127.0.0.1:5173, log in, and start a research question.

Vite proxies `/api` to port 3000. In a deployed frontend set `VITE_API_BASE_URL`
if the API is on a different origin and set `FRONTEND_ORIGIN` on the API. The API
currently binds loopback for local development; deployment requires an explicit
host binding and a reverse proxy. Configure Supabase email redirect URLs as
shown in AUTH.md. The API and worker are separate long-running processes.

## Flow and persistence

The cookie-authenticated API resolves an opaque HttpOnly session ID through Redis, creates an owned project and returns 202, then BullMQ runs
planning and plan review → search and optional follow-up review → source deduplication
→ per-query summaries → topic merge → claim verification → report. Reports are assembled from verified claims, so no uncited summary is
introduced after verification. Source IDs link claims to stored excerpts. This
is evidence review, not a guarantee that sources or model judgments are true.

The worker persists checkpoints before provider calls and after completed stages.
Retry resumes completed stages. One job executes per worker by default; searches
within a run execute sequentially. Quick overview uses at most three initial
queries; deep research uses six. Search review can request up to two additional rounds
of at most two queries each. Each query returns up to ten results; there is no ten-source cap on the final run.
Canonical URLs, near-identical excerpts, and a conservative model similarity pass
deduplicate results across queries. Related topics and competing evidence stay separate.
Review input shares a 10,000-character summary budget across queries, including
follow-ups. Invalid model structures receive one correction attempt with required
fields explicitly listed; every nested request and correction counts against the
provider-call budget. Successful searches, deduplication aliases, per-query summaries,
and requested source bodies are checkpointed. Each query is summarized independently
using all of its remaining results, a shared 6,500-byte excerpt/context budget, and
exact source-ID/quote pairs. Up to four findings, disagreements, unanswered questions,
and context requests are returned per query. Source bodies are fetched through Exa
`/contents` only when requested, capped at 50,000 characters, and relevant contiguous
passages are supplied for a revised summary. Unresolved context remains a limitation.
A run allows at most 140 provider calls across attempts and 30 minutes from first execution. OpenRouter requests time out
at 60 seconds and search at 45 seconds. Transient failures retry up to ten total
attempts with provider-aware exponential backoff. Invalid credentials/requests and insufficient
evidence fail without repeated attempts. Small account/provider limits can still
cause failures; the UI reports this and preserves collected sources.

`requestId` is a user-scoped UUID idempotency key. Reusing it with different
input returns 409. Admission limits: three active runs and twenty new runs per
rolling 24 hours per user. The API checks ownership on list/read/cancel. RLS
allows authenticated users to read their own rows through Supabase; direct
client inserts/updates/deletes are revoked. Server database access is privileged
and explicitly scoped by the server-side session owner ID. See `../frontend/AUTH.md`
for cookie security, CSRF checks, and email callback configuration. Historical rows with null owners
are preserved and hidden; never assign them to an arbitrary user.

The database pending row acts as the enqueue intent. If enqueue fails, the API
still returns the saved project; the worker reconciles outstanding rows every
15 seconds using a deterministic BullMQ job ID. Final/stalled queue failures and
expired runs are reflected in Postgres. Unique run tokens fence stale workers
from overwriting newer attempts. Cancellation is durable and checked every two
seconds and before checkpoint writes; it aborts in-flight HTTP requests, but a
provider may still charge for work already accepted.

The queue uses the new `research-v2` name; old prototype jobs are not replayed.
Do not remove existing prototype queues until their contents have been reviewed.
Old browser-local drafts are not automatically uploaded or assigned to an account.

## Verification

- `npm test`: checkpoint recovery, cancellation, budget and deadline enforcement,
  empty evidence, invalid citations, planner validation, search/extraction options.
- `npm run typecheck`: backend and shared contracts.
- `npm run build --prefix frontend` and `npm run lint --prefix frontend`.
- `node --import tsx backend/scripts/queue-resilience.ts`: temporary isolated Redis;
  retry, worker crash, Redis outage, and restart persistence checks.
- `node --import tsx backend/scripts/integration-smoke.ts`: live paid Exa/OpenRouter run
  through API → queue → worker → database. Uses short-lived synthetic Redis sessions,
  two synthetic owner IDs, a separate queue, and test-owned rows.
  Production auth configuration is never changed. Tests ownership and RLS, duplicate
  requests, cancellation, and rereading a saved report. Cleans up only test data.
  Writes the resulting report to `/tmp/fieldwork-live-report.md`.

The one-time `baseline-existing.ts` repair was used only because the original
migration files had been regenerated after deployment. It checks the known
8-column baseline before recording matching history. Normal setups should only
run `db:migrate`; do not run the baseline script on new or changed schemas.

## Existing local Redis

AOF was enabled at runtime on the existing `redis` container and its initial
rewrite and writes were verified successful. Its eviction policy is `noeviction`.
That container has no mounted volume, and the runtime setting does not update
its startup command. Use `compose.research.yml` for a named data volume and
explicit AOF startup configuration. It has not replaced the existing container;
plan migration of existing data before recreating that service.


### Provider-call budget

`RESEARCH_MAX_PROVIDER_CALLS` defaults to 140 and must be a positive integer.
The expanded flow includes a semantic deduplication pass, one summary per initial
or follow-up query, optional full-source requests and revised summaries, a topic
merge, batched verification, and a paraphrased opening summary. Every actual request,
correction, and retry counts; completed query summaries and source bodies are reused
on retries. The shared 30-minute deadline applies independently. Provider token/rate
limits remain separate and are not increased. Restart the worker after configuration
changes. Already failed runs require a new submission.

### Provider rate limiting

Workers coordinate OpenRouter requests through a Redis rolling 60-second token/request
window. Configure `OPENROUTER_TOKENS_PER_MINUTE` (default 8000) and
`OPENROUTER_REQUESTS_PER_MINUTE` (default 30) to match your actual organization/model
allowance. Token reservations estimate serialized request bytes plus the maximum
completion allowance; they are conservative estimates, not the model tokenizer.
Do not increase these values just to bypass throttling. Workers for the same
organization/model must share Redis and `OPENROUTER_RATE_LIMIT_GROUP` (default `default`).
Other apps using the organization may still cause 429 responses.

On 429, OpenRouter and Exa publish a shared cooldown and retry the individual request
up to twice. `Retry-After` (seconds or date) takes priority, followed by a provider token-reset header when present, with a 60-second fallback. Failed requests count against the
run budget; waiting does not add extra calls. Persistent throttling goes to the
queue, whose new `provider` backoff never waits less than the provider hint.
Existing queued jobs retain their old backoff, but shared admission still blocks
requests during cooldown. Cancellation and the 30-minute deadline interrupt
waits. Longer quota exhaustion can still fail a run; limits are not bypassed.

`RESEARCH_WORKER_CONCURRENCY` defaults to 1 so one local run does not spend its
deadline waiting behind another. Redis coordination also applies across multiple
worker processes. Restart API and worker processes after deployment/config changes.
The scheduler is registered by the worker; standalone provider smoke scripts do
not register it. Model tests use fake providers; Redis concurrency tests use an
isolated temporary instance.

Small plan/review responses reserve 1400 completion tokens, per-query summaries 1800,
claim verification 800, and the merge 1200. UTF-8 byte budgets keep non-English source
excerpts within the same scheduler estimates without changing quoted substrings.

See https://openrouter.ai/docs/api/reference/limits for response-header semantics and
check your own account limits in the OpenRouter dashboard. Logs include the provider and
retry delay; the user sees a rate-limit-specific message when retries are exhausted.


### Report presentation and evidence detail

New reports open with the question and a short, direct-answer paragraph, followed
by topic headings with supporting bullets, limitations and open questions, and
sources. Six initial queries produce six summaries; review queries are summarized too.
The merge groups all findings by topic and collapses equivalent claims while retaining
original source IDs and quotations. Opposing evidence is kept as separate findings and
marked as competing evidence. Findings omitted by model grouping are retained. Quotes
are validated against supplied source text before saving; final claim verification runs
in batches of four. Source excerpts from targeted full-text retrieval are saved alongside
source records so citation verification survives retries.

The frontend uses site logos for citations, with a globe fallback, and shows source
names and domains rather than internal IDs. Sources & evidence displays one link per
retained source, without repeating excerpt descriptions below every source. New runs
use the per-query flow; unfinished legacy runs upgrade when they resume. Completed
reports are not rewritten automatically. The existing JSON checkpoint stores summaries,
aliases, and retrieved source bodies; no database migration is required.

Exa full-text request fields follow the [official contents API guidance](https://github.com/exa-labs/agent-skills/blob/main/skills/exa-contents/SKILL.md).

### Worker log files

`npm run worker` mirrors stdout and stderr into Markdown files in the repository's
`logs/` directory while retaining terminal output. Each research run writes to
`<question>+<start-time>+<project-id>.md`; the question is made filename-safe and
bounded in length, and the project ID prevents collisions. Retries append to the
same file, including provider diagnostics and the final failed/completed event.
Concurrent runs retain separate logs through async context tracking.

`worker+<start-time>+<pid>.md` contains the entire worker session, including startup,
connection/recovery errors, and all run output. Files are appended synchronously so
already-written diagnostics survive termination. Log write failures are reported
to stderr without stopping research. The existing `.gitignore` excludes `logs/`.

### Review queries and opening summary

Review-generated queries are appended to the plan before their search request and
saved through the existing checkpoint transaction to both `research_plan` and
`checkpoint.plan`. Failed requests resume from that saved plan. When older runs
resume, cached search queries are merged into the plan without duplicates.

New report layouts store a separately written `summary`: a short paragraph that
paraphrases the main takeaways across all verified findings and preserves relevant
limitations. The summary receives a separate support/paraphrase check and cites
its supporting findings. Detailed bullets retain the verified claims. Resumed
layouts missing a summary are regenerated; previously completed reports are not
rewritten automatically. No database migration is needed for these JSON fields.
