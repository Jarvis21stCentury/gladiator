# Deploying to Vercel

Single-user deployment — you only. Sharing with other people needs the work in
MULTI-USER.md first; do not skip that and hand out the URL.

## Before you start

Two things about this app that shape every step below:

- **It has no login.** Anyone who reaches the URL sees your grades and can spend
  your LLM credit. Step 6 is not optional.
- **Its database is not local-friendly.** `DATABASE_URL` currently points at
  `localhost`, which Vercel cannot reach. You need a hosted Postgres.

---

## 1. Create a hosted Postgres

Any of these; all have a free tier that comfortably fits one student.

- **Neon** — neon.tech, "New Project", copy the connection string.
- **Vercel Postgres** — create it from the Vercel dashboard after step 3 and it
  wires `DATABASE_URL` in for you.
- **Supabase** — supabase.com, Project Settings → Database → Connection string.

Copy the connection string. It looks like:

```
postgresql://user:password@host.region.aws.neon.tech/dbname?sslmode=require
```

## 2. Create the tables in it

From the project directory, pointing at the **new** database rather than your
local one:

```bash
DATABASE_URL="<the new connection string>" npx prisma migrate deploy
```

`migrate deploy` applies the existing migrations without prompting and without
touching data — it is the production counterpart of `migrate dev`.

**Start fresh rather than copying your local data.** Every sync path works, so
five minutes of re-syncing in step 7 rebuilds everything cleanly, without the
merge artefacts accumulated during development.

## 3. Link the project

```bash
vercel login     # opens a browser
vercel link      # create a new project when asked
```

## 4. Set the environment variables

In the Vercel dashboard → your project → Settings → Environment Variables. Set
each for **Production, Preview and Development**.

| Variable | Value |
|---|---|
| `DATABASE_URL` | the hosted connection string from step 1 |
| `CREDENTIAL_SECRET` | **copy the exact value from your local `.env`** |
| `LLM_PROVIDER` | `openai` |
| `LLM_API_KEY` | your Hack Club key |
| `LLM_BASE_URL` | `https://ai.hackclub.com/proxy/v1` |
| `LLM_MODEL_FAST` | `~openai/gpt-mini-latest` |
| `LLM_MODEL_STRONG` | `~openai/gpt-mini-latest` |

`CREDENTIAL_SECRET` is the one people get wrong. It is the key your HAC password
is encrypted with. A different value there does not fail loudly — the app starts
fine and then cannot decrypt your HAC login, and the sync fails with something
that looks like a HAC problem.

Canvas and HAC credentials are **not** environment variables. They live in the
database and you enter them through the UI in step 7.

## 5. Deploy

```bash
vercel --prod
```

The build runs `prisma generate && next build`. It does **not** run migrations,
which is why step 2 exists.

## 6. Lock it down

Vercel dashboard → Settings → Deployment Protection → **Vercel Authentication**.

This requires a Vercel login to view the site, and your account is the only one
that has it. Without this the URL is public: your grades are readable by anyone
who finds it, and `/api/digest/generate` can be POSTed by anyone to burn your
Hack Club credit. The cron routes carry no secret of their own.

Confirm it works by opening the production URL in a private window — you should
be asked to sign in to Vercel, not shown the front page.

## 7. Connect your accounts

Open the production URL and, in this order:

1. **Canvas** — the connect form. Base URL `https://fisd.instructure.com`, plus a
   personal access token from Canvas → Account → Settings → New Access Token.
2. **HAC** — base URL `https://hac.friscoisd.org`, your district username and
   password.
3. **Routine** (`/routine`) — your week, and check the school year dates. The
   nine-week periods are derived from them.
4. **Sync** from the front page, then **Build tonight's notes** on `/study`.

## 8. Check the crons

`vercel.json` already schedules them:

- `/api/cron/morning` — 11:15 UTC
- `/api/cron/evening` — 22:00 UTC

Vercel dashboard → your project → Cron Jobs, to confirm both are registered.
They appear only on a production deployment.

**These times are UTC.** 22:00 UTC is 5pm Central during daylight saving and 4pm
otherwise — probably earlier in the evening than you want the digest written.
Adjust the schedules in `vercel.json` and redeploy.

Hobby plan crons run **once a day** and are not minute-accurate. That is fine
for these two.

## If something breaks

- **Build fails on Prisma** — `DATABASE_URL` is missing from the Vercel env vars.
  The build runs `prisma generate`, which needs it.
- **Pages load, syncs fail** — Canvas/HAC not connected yet, or
  `CREDENTIAL_SECRET` differs from the one the password was encrypted with.
- **Digest returns 500** — check `LLM_BASE_URL` is set. Without it the client
  talks to `api.openai.com`, where your Hack Club key is not valid.
- **Function timeout** — the digest and syllabus routes declare
  `maxDuration = 60`. Hobby's ceiling is 60s, so a slow run is cut off rather
  than failing cleanly. Press the button again; work already done is skipped.
