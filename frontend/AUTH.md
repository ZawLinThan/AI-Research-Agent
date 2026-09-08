# Authentication UI

Routes: `/login`, `/signup`, `/forgot-password`, and `/reset-password`.
The workspace at `/` remains a public frontend preview. Its browser-local drafts
are not account-scoped or synced; this is not an access-control boundary.

Forms use the browser Supabase client with `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` from `.env.local`. Never use a service-role key
in the frontend. Missing configuration produces a form error instead of a crash.

In Supabase Authentication → URL Configuration, allow these redirect URLs for
local development, plus equivalent paths on the deployed origin:

- `http://127.0.0.1:5173/login`
- `http://127.0.0.1:5173/reset-password`

If using localhost rather than 127.0.0.1, allow that origin separately. Set the
Site URL to the deployed origin. Production hosting must serve `index.html` for
these client routes. Email/password auth must be enabled. Email confirmation
and password policy are controlled by Supabase; the UI enforces a minimum of
8 characters for new passwords and reports stricter server-policy errors.

Recovery emails return to `/reset-password`; Supabase processes the session
from the recovery link. The screen requires a session before allowing a password
update and offers a new recovery link if the session is absent. Confirmation
emails return to `/login`. Successful sign-in or sign-up with an immediate
session opens the workspace. Sign out clears the Supabase session.

Verification: production build and ESLint; browser layout and local navigation
checks. Live sign-up, email delivery, and password changes require an account
owner to complete the flows; no accounts or emails were created during UI QA.
