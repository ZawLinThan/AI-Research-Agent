# Authentication

React calls Express `/api/auth/*` endpoints using `credentials: include`.
Supabase access and refresh tokens stay in Redis. The browser receives only a
random session ID in a host-only HttpOnly, SameSite=Lax cookie. HTTPS/production
uses `__Host-fieldwork-session` with Secure; local HTTP development uses
`fieldwork-session` without Secure. The session has an absolute 30-day lifetime.
The backend refreshes provider tokens on demand with a distributed Redis lock.
Logout deletes the stored session before attempting provider revocation.

The browser no longer creates a Supabase client or stores tokens. Old localStorage
credentials for the configured `VITE_SUPABASE_URL` project are removed on startup;
existing users must log in again. That optional Vite variable is only used for this
cleanup. No Supabase key is needed in the frontend. User identity is returned by
`GET /api/auth/session`; research routes resolve the cookie server-side.

## Run and configure

Run Redis, `npm run dev` at the repository root, and the frontend Vite server.
The existing Vite `/api` proxy includes auth endpoints. The worker is required for
research, but not for login. The backend needs `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` (or the SDK's plural key configuration), plus its normal
application environment. No Supabase secret/admin key is used by authentication.

Set `FRONTEND_ORIGIN` to the frontend origin, without a path. Use one hostname
consistently: localhost and 127.0.0.1 do not share cookies. In production set
`NODE_ENV=production`, use HTTPS, and preferably proxy `/api` on the frontend origin.
For separate same-site frontend/API origins, set `VITE_API_BASE_URL` and
`AUTH_CALLBACK_URL` to the API's full `/api/auth/callback` URL. Unrelated sites are
not supported by this SameSite=Lax design. `TRUST_PROXY` may name trusted Express
proxy addresses/subnets (for example `loopback` when the reverse proxy is local);
leave it unset if requests arrive directly. Do not blindly trust forwarded IPs.

POST requests require an allowed Origin and `X-CSRF-Protection: 1`. CORS allows
credentials only for configured origins. Authentication attempts are limited to
30 per 10 minutes per observed client IP, in addition to Supabase's limits.
Auth/API responses use Cache-Control: no-store. Redis now contains credentials:
keep it private, use authenticated/TLS access when remote, and protect backups.
Existing Redis persistence determines whether sessions survive Redis restarts.

## Email confirmation and password recovery

**Update Supabase Authentication → URL Configuration → Redirect URLs** to allow:

- `http://127.0.0.1:5173/api/auth/callback**`
- `http://localhost:5173/api/auth/callback**` if using localhost
- The deployed callback URL with a suffix wildcard for its `state` query string

These narrowly scoped patterns allow the random callback state. If
`AUTH_CALLBACK_URL` is set, allow that URL instead. Keep email templates using
Supabase's `ConfirmationURL` so Supabase verifies the email token and redirects
with a PKCE code. Set Site URL to the deployed frontend origin. The server validates
the callback state against an HttpOnly flow cookie, exchanges the code using a
server-stored verifier, sets the session, and redirects to `/` or `/reset-password`.
Tokens never appear in the frontend URL. Open the email in the same browser that
requested it. Flow state expires after one hour; requesting another link replaces
that browser's previous flow. Older implicit-flow links must be requested again.

Routes remain `/login`, `/signup`, `/forgot-password`, and `/reset-password`.
Sign-up may require email confirmation according to Supabase configuration.
Recovery always shows the same success response for existing/nonexisting addresses.
Changing a password ends the application session and asks the user to sign in again.

## Verification

`npm test` includes mocked-provider HTTP integration checks for login, sign-up,
recovery callbacks, password changes, CSRF, cookie flags, session rotation,
refresh failure, and logout/refresh races. No real email is sent or account changed.
`npm run typecheck`, frontend build and lint check application integration.
The optional live research smoke script seeds isolated synthetic cookie sessions;
it does not test real Supabase email delivery. Verify email delivery and redirect
allowlisting with a real account after applying the Supabase configuration above.
