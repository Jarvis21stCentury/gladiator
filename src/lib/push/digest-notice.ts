import "server-only";

import { prisma } from "@/lib/prisma";
import { currentGradingPeriod } from "@/lib/grading-period";
import { getSchoolYear } from "@/lib/school-year";

import { sendPush, type PushResult } from "./send";

/**
 * The one message a day that makes the whole unattended half of this app worth
 * having.
 *
 * ## What goes in it, and what deliberately does not
 *
 * A notification is read in about a second, on a lock screen, usually while
 * doing something else. So it carries the two facts that change behaviour —
 * what is overdue, and what is due tomorrow — and nothing else. No grade, no
 * card count, no "3 classes distilled": those are things to look at, not things
 * to be told, and every one of them added to the line makes the two that matter
 * harder to find.
 *
 * Nothing is sent when there is nothing to say. A daily notification that
 * regularly means "no news" trains the student to dismiss it unread, at which
 * point the one that mattered gets dismissed too.
 */

/** A notification long enough to be useful, short enough not to be truncated. */
const MAX_TITLES = 3;

export async function sendEveningNotice(): Promise<PushResult> {
  const now = new Date();

  const startOfTomorrow = new Date(now);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  startOfTomorrow.setHours(0, 0, 0, 0);

  const endOfTomorrow = new Date(startOfTomorrow);
  endOfTomorrow.setHours(23, 59, 59, 999);

  const year = await getSchoolYear();
  const period = currentGradingPeriod(year, now);

  const [overdue, tomorrow] = await Promise.all([
    prisma.assignment.count({
      where: {
        submitted: false,
        dueAt: { lt: now, gte: period.start },
        course: { hidden: false },
      },
    }),
    prisma.assignment.findMany({
      where: {
        submitted: false,
        dueAt: { gte: startOfTomorrow, lte: endOfTomorrow },
        course: { hidden: false },
      },
      select: { title: true, course: { select: { name: true } } },
      orderBy: { dueAt: "asc" },
    }),
  ]);

  if (overdue === 0 && tomorrow.length === 0) {
    return { sent: 0, removed: 0, failed: 0, skipped: "Nothing due — no notice sent." };
  }

  const lines: string[] = [];

  if (tomorrow.length > 0) {
    // Titles, not a count. "3 things due tomorrow" makes you open the app to
    // find out whether you have already done them; the titles often do not.
    const named = tomorrow.slice(0, MAX_TITLES).map((item) => item.title);
    const rest = tomorrow.length - named.length;

    lines.push(
      `Due tomorrow: ${named.join(", ")}${rest > 0 ? ` +${rest} more` : ""}`,
    );
  }

  if (overdue > 0) {
    lines.push(`${overdue} overdue`);
  }

  return sendPush({
    title:
      tomorrow.length > 0
        ? `${tomorrow.length} due tomorrow`
        : `${overdue} overdue`,
    body: lines.join(" · "),
    url: "/",
    // One tag for the nightly notice, so tonight's replaces last night's
    // instead of a week of them piling up on the lock screen.
    tag: "evening",
  });
}
