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
Retry resumes completed stages. Up to two jobs execute concurrently; searches
within a run execute sequentially. Quick overview uses at most three initial
queries; deep research uses six. Search review can request one additional round
of at most two queries. Ten results per query are deduplicated into at most ten sources.
Review input shares a 10,000-character summary budget across queries, including
follow-ups. Invalid model structures receive one correction attempt with required
fields explicitly listed; every nested request and correction counts against the
provider-call budget. Successful searches are checkpointed before review. Context is capped at two
900-character excerpts per source. A run allows at most sixteen provider calls
across attempts and eight minutes from first execution. Groq requests time out
at 60 seconds and search at 45 seconds. Transient failures retry up to three total
attempts with exponential backoff. Invalid credentials/requests and insufficient
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
