# What's left

Ordered by value, and every item here comes from something observed in this
student's real data — not from a list of features a school tool might have.

## 1. Notifications

**The biggest hole in the product.** The crons write to the database and stop.
If the student does not open the app, it tells them nothing — no "test
tomorrow", no "three overdue", nothing on a phone. For a tool meant to be
depended on, that is the difference between something that has your back and a
dashboard you have to remember to check.

Cheapest useful version: a nightly push or email at a set time with what is due
tomorrow and anything overdue. Web Push works on iOS 16.4+ as an installed PWA;
email via Resend is simpler and needs no install.

## 2. Confirm the planner schedules future work

Reported as "it only tells me to work on stuff due today". Not yet verified.
`LOOKAHEAD_DAYS` is 10, so the query does pull future work — but the routine was
empty at the time it was reported, so the planner had no free time to place
anything into and produced an empty plan. Re-check now the routine is restored
before changing any code.

If it really is today-only, the cause is in `src/lib/planner/schedule.ts`
prioritisation, not in the lookahead.

## 3. The GT Humanities rename

The Canvas sync overwrites `Course.name` on every upsert, so the manual merge
that linked "GT Humanities 2/AP World" to its Canvas course gets renamed back to
"GT HumanitiesI/Eng 1 Adv YR (MOTLEY, KYLE)" on the next sync.

Cosmetic today. The real risk is that the HAC sync matches courses *by name*, so
it may stop recognising the row and split the class in two again. Needs a
decision about which system owns a course's display name — probably HAC, with a
flag so Canvas fills in only when HAC has not named it.

## 4. Multi-user

Fully planned in MULTI-USER.md. Five phases. The whole risk is one unscoped
query showing one student another student's grades, which is why the plan uses a
Prisma client extension rather than careful editing of ~50 call sites.

Not needed for one student. Needed the moment a friend wants their own data in
the same deployment.

## 5. Smaller, real

- **101 cards from one class.** Chemistry's 32 key points produced ~3 cards
  each. Tighten the card prompt, or cap per note.
- **Cron times are UTC.** `0 22 * * *` in `vercel.json` is 5pm Central — the
  "nightly" digest runs mid-afternoon.
- **Front page scrolls sideways at 390px.** Pre-existing, confirmed by stashing
  every change and reproducing it. It is the pinned chart's ScrollTrigger
  spacer.
- **Two deployments share one password.** Fine while both are the student's;
  wrong as soon as the code-sharing one is shared.
- **Google Drive folders cannot be read**, only individual files. Chemistry's
  "Unit 1 Notes and PWS" is a folder link and is skipped. Needs Drive API auth.

## Deliberately not doing

Attendance, transcripts, teacher messaging, group projects, college
applications, note-taking, anything social. Some belong to HAC, some to nobody's
tool. The bar this app is trying to clear is **everything about what is due and
how you are doing**, and it is close to that — not "everything a student needs",
which is not a specification.

## How to pick

The two that change daily life most are **notifications** (1) and **confirming
the planner works** (2). Item 2 is half an hour and might need no code at all.
Item 1 is an afternoon and is the difference between opening the app and being
told.
