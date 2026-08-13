# ARCHITECTURE.md — Gladiator

## Scope

Single-user, personal tool. No accounts system, no multi-tenant auth, no other students' data involved — that simplifies a large share of the build. Skip anything in tutorials or boilerplate that exists only to support multi-user products.

## Data sources

| Source | Status | Approach |
|---|---|---|
| Canvas | Full API access | Personal access token (Canvas → Account → Settings → Approved Integrations → New Access Token). Fallback: the account's private iCal "Calendar Feed" URL if token access is ever restricted — no auth needed, due dates only, no grades. |
| Google Calendar | Full API access | Personal Google account (not school), standard OAuth 2.0, Google Cloud project in Testing mode with the developer as the sole test user — no verification process needed at this scale. |
| Google Drive | Partial, by design | No full-account sync — school Google Workspace for Education blocks unconfigured third-party OAuth apps for under-18 accounts by default. Instead: ingest specific files/folders by file ID, sourced from "anyone with the link" shares or links surfaced through Canvas modules. Treat Drive as a linked reference, never a mirrored account. |
| Gmail | Out of scope | Handled manually by the user — do not build automated email ingestion. |
| HAC (Home Access Center) | Optional / stretch, do last | No official public API. An unofficial route exists via the underlying StudentVUE SOAP web service, but it requires the user's raw HAC password (not a scoped token) and isn't sanctioned by district policy. Do not build this until every other phase is done and the tradeoff has been explicitly re-confirmed with the user. |

## Stack

- **Framework**: Next.js (App Router) + TypeScript + Tailwind
- **Data**: Prisma + Postgres (Neon)
- **Hosting**: Vercel
- **Scheduled jobs**: Vercel Cron polling Canvas + Calendar (e.g. every 30–60 min during school hours, less frequently overnight)
- **LLM**: OpenAI API by default; keep the prompt/completion layer behind a single, provider-agnostic wrapper module so swapping to Anthropic's API later is a one-file change, not a rewrite
- **Auth**: none. Canvas token and Google OAuth refresh tokens live in encrypted environment variables. The app runs as a single identity — there is no login screen and no user table.

## LLM usage guidance

Use a cheap/fast model for routine, structured tasks: struggle-flag classification, workload scoring. A stronger tier exists for the three things a person reads rather than scans — the daily-plan narrative, the nightly lesson digest summary, and the weekly retro.

**Both OpenAI tiers currently resolve to `gpt-4o-mini`.** The strong tier was gpt-4o and came to roughly 85% of the bill, because the digest is the only frequent strong call — once per class per school day. The two tiers are kept rather than collapsed so restoring quality is one env var (`LLM_MODEL_STRONG=gpt-4o`) rather than a hunt through call sites. Set a soft monthly spend cap as a backstop regardless.

## Rough data model

```
Course        { canvasId, name, term, currentGradePercent }
Assignment    { canvasId, courseId, title, dueAt, pointsPossible, submitted, score }
GradeSnapshot { courseId, date, gradePercent }        // powers trend detection
CalendarBlock { title, start, end, type, googleEventId, linkedAssignmentId }
DriveFileRef  { fileId, name, url, linkedAssignmentId, lastSynced }
StruggleFlag  { type, courseId, description, detectedAt, resolved }
DailyPlan     { date, tasks[], generatedSummary }
WeeklyRetro   { weekStart, summaryText, wins[], struggles[] }
LessonNote    { id, date, courseId, sourceType, rawInputRef, keyPoints[], generatedSummary }
EffortLog     { assignmentId, estimatedMinutes, actualMinutes, note }
CollegeItem   { name, dueDate, category, hoursLogged }   // scholarships, ECs, app deadlines
```

## Open decisions to confirm before coding

- Confirm Canvas personal access tokens aren't disabled for this account (Settings → Approved Integrations)
- OpenAI vs Anthropic for the LLM layer (or keep it provider-agnostic from day one, recommended)
- Pick one notification channel to build first (Discord bot, SMS digest, or widget) — not all three
- Whether HAC is worth the unofficial-wrapper tradeoff, or whether Canvas grades are close enough to skip entirely
- How textbook pages get into the nightly digest — photo upload (needs a vision-capable model call) vs. a saved PDF page range (skips OCR)
