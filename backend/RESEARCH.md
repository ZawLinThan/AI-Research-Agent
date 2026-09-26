# Research pipeline

## Run locally

1. Configure the root `.env`: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `GROQ_API_KEY`, `EXA_API_KEY`. Optional: `GROQ_MODEL` (default
   `openai/gpt-oss-20b`), `REDIS_URL`, or `REDIS_HOST`, `REDIS_PORT`,
   `REDIS_PASSWORD`. Never expose provider secrets in Vite variables.
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
planning and plan review → search and optional follow-up review → evidence analysis → claim verification
→ report. Reports are assembled from verified claims, so no uncited summary is
introduced after verification. Source IDs link claims to stored excerpts. This
is evidence review, not a guarantee that sources or model judgments are true.

The worker persists checkpoints before provider calls and after completed stages.
Retry resumes completed stages. One job executes per worker by default; searches
within a run execute sequentially. Quick overview uses at most three initial
queries; deep research uses six. Search review can request up to two additional rounds
of at most two queries each. Ten results per query are deduplicated into at most ten sources.
Review input shares a 10,000-character summary budget across queries, including
follow-ups. Invalid model structures receive one correction attempt with required
fields explicitly listed; every nested request and correction counts against the
provider-call budget. Successful searches are checkpointed before review. Context is capped at two
900-character excerpts per source. A run allows at most 40 provider calls
across attempts and eight minutes from first execution. Groq requests time out
at 60 seconds and search at 45 seconds. Transient failures retry up to three total
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
- `node --import tsx backend/scripts/integration-smoke.ts`: live paid Exa/Groq run
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

`RESEARCH_MAX_PROVIDER_CALLS` defaults to 40 and must be a positive integer.
Deep research can use 21 calls (including two planner revisions and two search
follow-up rounds), or 32 with one correction for every model call. The remaining
eight calls allow limited transient retries. The counter persists across queue
attempts; it is never reset to bypass the cap. The fifteen-minute deadline still
applies independently. Provider token/rate limits are separate from this limit.
Restart the worker after changing the environment. Already failed runs require
a new submission.

### Provider rate limiting

Workers coordinate Groq requests through a Redis rolling 60-second token/request
window. Configure `GROQ_TOKENS_PER_MINUTE` (default 8000) and
`GROQ_REQUESTS_PER_MINUTE` (default 30) to match your actual organization/model
allowance. Token reservations estimate serialized request bytes plus the maximum
completion allowance; they are conservative estimates, not the model tokenizer.
Do not increase these values just to bypass throttling. Workers for the same
organization/model must share Redis and `GROQ_RATE_LIMIT_GROUP` (default `default`).
Other apps using the organization may still cause 429 responses.

On 429, Groq and Exa publish a shared cooldown and retry the individual request
up to twice. `Retry-After` (seconds or date) takes priority, followed by Groq's
token reset duration, with a 60-second fallback. Failed requests count against the
run budget; waiting does not add extra calls. Persistent throttling goes to the
queue, whose new `provider` backoff never waits less than the provider hint.
Existing queued jobs retain their old backoff, but shared admission still blocks
requests during cooldown. Cancellation and the fifteen-minute deadline interrupt
waits. Longer quota exhaustion can still fail a run; limits are not bypassed.

`RESEARCH_WORKER_CONCURRENCY` defaults to 1 so one local run does not spend its
deadline waiting behind another. Redis coordination also applies across multiple
worker processes. Restart API and worker processes after deployment/config changes.
The scheduler is registered by the worker; standalone provider smoke scripts do
not register it. Model tests use fake providers; Redis concurrency tests use an
isolated temporary instance.

Small plan/review responses reserve 1400 completion tokens, claim verification
reserves 800, and evidence analysis retains 2500. Analysis uses one excerpt of up
to 450 characters per selected source while full retrieved highlights remain stored.
This trades some evidence context for fitting the configured provider allowance.

See https://console.groq.com/docs/rate-limits for response-header semantics and
check your own account limits in the Groq console. Logs include the provider and
retry delay; the user sees a rate-limit-specific message when retries are exhausted.
