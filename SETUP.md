# Running your own copy

Gladiator is a personal school command center: it pulls your classes and
assignments from Canvas, your grades from Home Access Center, reads your
teachers' coursework pages and linked slide decks, and turns the day's material
into notes, flashcards and a schedule.

**It is single-user.** One deployment holds one student's data. That is why you
run your own copy rather than logging in to someone else's — there is no login,
and no way to keep two students' work apart in one deployment. Everything below
gives you your own database that nobody else can see.

About 20 minutes. Everything used here has a free tier.

## What you need first

- A **GitHub** account
- Your school's **Canvas** and **Home Access Center** logins
- A **Hack Club** AI key if you're a Hack Club member (free), or an OpenAI key
  with a few dollars on it. Without one, most things still work — syncing,
  assignments, grades, the timetable, hand-written flashcards — but the AI
  parts do not: nightly notes, generated flashcards, reading test dates out of
  assessment plans, and the daily plan.

---

## 1. Fork the repo

Open the project on GitHub and press **Fork**. That gives you your own copy to
deploy from.

Then clone it and install:

```bash
git clone https://github.com/<your-username>/gladiator.git
cd gladiator
npm install
```

## 2. Create a database

Go to **[neon.tech](https://neon.tech)**, sign in with GitHub, and create a new
project. Copy the **connection string** — it starts `postgresql://`.

## 3. Set up your environment file

```bash
cp .env.example .env
```

Open `.env` and set:

```bash
DATABASE_URL="<the Neon connection string>"

# Any long random string. Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# This encrypts your HAC password. Never share it, and never change it after
# you have connected HAC — the stored password can only be decrypted with the
# value it was encrypted under.
CREDENTIAL_SECRET="<paste the generated string>"

# Hack Club (free for members):
LLM_PROVIDER="openai"
LLM_API_KEY="<your sk-hc-v1-... key>"
LLM_BASE_URL="https://ai.hackclub.com/proxy/v1"
LLM_MODEL_FAST="~openai/gpt-mini-latest"
LLM_MODEL_STRONG="~openai/gpt-mini-latest"

# Using OpenAI directly instead? Set LLM_API_KEY to your sk-proj-... key,
# delete the LLM_BASE_URL line, and set both models to "gpt-4o-mini".
```

Canvas and HAC credentials are **not** in here. You enter those in the app.

## 4. Create the tables

```bash
npx prisma migrate deploy
```

## 5. Try it locally

```bash
npm run dev
```

Open http://localhost:3000. You should see empty pages rather than errors —
"Nothing synced yet" is correct at this stage.

## 6. Deploy

```bash
npm i -g vercel
vercel login
vercel link          # create a new project when asked
```

Then add the same variables to Vercel. In the dashboard: your project →
**Settings → Environment Variables**, and add each of the seven from your
`.env` to **Production, Preview and Development**.

```bash
vercel --prod
```

## 7. Lock it down

Vercel dashboard → **Settings → Deployment Protection → Vercel Authentication**.

This is on by default on new projects — confirm it. The app has no login of its
own, so this is the only thing standing between your grades and anyone who
finds the URL. Check by opening the site in a private window: you should be
asked to sign in to Vercel.

## 8. Connect your accounts

Open your production URL and work through:

1. **Canvas** — your school's Canvas address (e.g. `https://fisd.instructure.com`)
   and a token from Canvas → Account → Settings → **New Access Token**.
2. **HAC** — your district's HAC address and your login.
3. **Routine** (`/routine`) — your week, and the school year start and end
   dates. The nine-week grading periods are worked out from those, so get them
   right.
4. **Sync** from the front page, then **Build tonight's notes** on `/study`.

## 9. Check the schedule

`vercel.json` runs two jobs: a morning one and an evening one that writes the
digest. **The times are UTC.** `0 22 * * *` is 5pm US Central — probably earlier
than you want. Edit `vercel.json` and redeploy.

---

## Things worth knowing

**It expects Canvas and HAC.** HAC decides which classes are real — a Canvas
enrolment that HAC does not list (homeroom, clubs, a district orientation
course) gets hidden automatically. Without HAC you will see every Canvas
enrolment and have to hide the extras yourself.

**The school year defaults to Frisco ISD's 2026-27 calendar.** Different
district? Change the dates on `/routine` first, before syncing.

**Coursework pages are found by title.** It looks for pages named things like
Coursework, Classwork, Agenda, Week, Unit or Calendar, follows the course home
page two hops deep, and reads Google Docs, Sheets and Slides that are shared
as "anyone with the link". If your teachers organise differently, the list of
title patterns is in `src/lib/digest/coursework.ts`.

**Google Drive folders cannot be read**, only individual files. Folder links
are skipped.

**Costs.** On Hack Club it is free. On OpenAI with `gpt-4o-mini`, roughly 40
cents a month; $5 lasts a school year. Expensive models are refused by default
— see `RUNAWAY_MODELS` in `src/lib/llm.ts`.

## If it breaks

- **Build fails on Prisma** — `DATABASE_URL` missing from the Vercel variables.
- **Sync fails right after connecting HAC** — `CREDENTIAL_SECRET` differs from
  the value the password was saved under. Clear the HAC credentials and enter
  them again.
- **Digest 500s** — `LLM_BASE_URL` is missing, so it is calling OpenAI with a
  Hack Club key.
- **A class shows no content** — the teacher may not have posted anything yet,
  which is normal early in a term.
