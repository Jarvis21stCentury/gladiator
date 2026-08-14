# Multi-user: the plan

Gladiator was built single-user on purpose — ARCHITECTURE.md: "single user, no
login, no user table". Every query trusts that there is only one student. This
document is the plan for undoing that assumption safely.

**The whole risk is one sentence: a single unscoped query shows one student
another student's grades.** There are ~19 models and dozens of query sites. Not
one of them may be missed, and a miss is silent — the page renders fine, with
the wrong person's data. Everything below is arranged around making a miss
impossible rather than unlikely.

## What is single-user today

- No auth of any kind. No `next-auth`, no session, no middleware.
- No `User` model. No `userId` column anywhere.
- `Setting` is a **global key/value table** holding `CANVAS_TOKEN`,
  `HAC_USERNAME`, `HAC_PASSWORD_ENC`, `SCHOOL_YEAR_START/END`. One student's
  credentials, shared by whoever opens the URL.
- Server actions take ids and trust them: `toggleTaskDone(taskId)` looks the row
  up by id and writes. With two users that is an IDOR — anyone can tick anyone's
  task by guessing a cuid.
- Cron routes (`/api/cron/morning`, `/api/cron/evening`) run "the" digest for
  "the" student.

## Order of work

Phased so the app is never half-migrated in a way that leaks. Each phase ends
with the app working.

### 1 — Auth, with nothing behind it yet

Add the provider and a session, but do not scope anything. Sign-in works,
`getSession()` returns a user, the app still shows the single shared dataset.

- Auth.js (next-auth v5) with Google — the students all have school Google
  accounts, and it avoids storing passwords.
- `User` model: `id`, `email` unique, `name`, `image`, `createdAt`.
- Middleware protecting every route except the sign-in page.

Ends with: you must log in; everyone still sees the same data. Safe because it
is no worse than today, and it proves the auth layer before anything depends on
it.

### 2 — Schema: `userId` everywhere, required

One migration, all at once. A partial migration is the dangerous state.

Models needing `userId` (verify against schema.prisma before writing):
`Course`, `Assignment`*, `GradeSnapshot`*, `EffortLog`*, `CalendarBlock`,
`RoutineBlock`, `DailyPlan`, `PlanTask`*, `WeeklyRetro`, `StruggleFlag`*,
`LessonNote`*, `DigestSource`*, `Flashcard`*, `FlashcardReview`*,
`GradeCategory`*, `SyllabusImport`*, `Announcement`*, `Setting`.

\* = reachable via `Course`, so it *could* be scoped by join. **Denormalise
`userId` onto all of them anyway.** A join-scoped query is one forgotten
`where` from leaking, and the extra column is free. Belt and braces.

`Setting` becomes `@@unique([userId, key])` — this is what makes credentials
per-student, and it is the single most important change in this phase.

Backfill: assign every existing row to the first user to sign in. The current
data is one student's.

### 3 — Scope every read and write

The mechanical, dangerous phase. Do not hand-edit ~50 call sites and hope.

**Build a per-request scoped client** rather than passing `userId` around:

```ts
// One place that knows how to scope. Callers cannot forget.
export async function db() {
  const userId = await requireUserId();   // throws if not signed in
  return prisma.$extends(scopeTo(userId));
}
```

A Prisma client extension that injects `where: { userId }` on every
`find*`/`update*`/`delete*`/`count`/`groupBy`, and `data: { userId }` on every
`create`. Then swap `prisma` for `await db()` across `src/lib` and
`src/app/actions.ts`.

Why an extension and not discipline: discipline fails silently here. With the
extension, a forgotten scope is impossible by construction, and the few places
that legitimately need cross-user access (cron) have to ask for the raw client
explicitly and visibly.

**Then verify by adversarial test, not by reading the diff.** Seed two users
with distinct data and assert every page and every action for user A never
returns or mutates a row of user B's. That test is the deliverable of this
phase — more than the code.

### 4 — Per-user credentials and background jobs

- Canvas/HAC/LLM config reads move from global `Setting` to the signed-in user's.
- `CREDENTIAL_SECRET` stays deployment-wide; the encrypted values become
  per-user rows.
- Cron routes iterate users: `for (const user of await allUsers())`. This is the
  one place that legitimately crosses users, so it uses the raw client and says
  so loudly. Watch the Vercel function timeout — six students' digests will not
  finish in 60s on Hobby. Likely needs a queue or one request per user.
- Rate limits and cost: every student runs their own digest nightly. On Hack
  Club's free tier that may be fine; check before inviting people.

### 5 — Onboarding

A new student signs in and has nothing. They need to reach "my classes are
here" without help: connect Canvas, connect HAC, set the school year, seed a
routine. Today that is spread across the Routine and Classes pages and assumes
you already know where to look.

## Things that will bite

- **`Setting` is read in ~8 places** including `getCanvasConfig`,
  `getHacCredentials`, `getSchoolYear`. All become user-scoped; the school year
  in particular is per-student because districts differ.
- **`signature` on `Flashcard` is globally unique.** Two students generating
  cards from the same shared Google Doc would collide. Must become
  `@@unique([userId, signature])`.
- **`canvasId` on `Course` is globally unique.** Two students in the same class
  have the same Canvas course id. Must become `@@unique([userId, canvasId])`.
  Same for `Assignment.canvasId` and `Announcement.canvasId`. **This one will
  not show up in testing with a single user and will break the second student
  who shares a class with the first.**
- **`externalId` on `DigestSource` is globally unique** — same problem, same fix.
- Server actions must stop trusting ids. Every one needs the scoped client so
  the row is only found if it belongs to the caller.

## Not doing

- Roles, sharing, or seeing a friend's grades. Out of scope and a different
  product.
- Password auth. Google only — no password resets, no hashing, no leaks.
