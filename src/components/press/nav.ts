/**
 * The five sections of the workbook, in one list.
 *
 * The nameplate index and the footer colophon both render from this — two navs
 * that can disagree about what exists is a bug waiting to happen.
 */
export interface Section {
  href: string;
  label: string;
  /** What this page actually is, set under the label in the nameplate index. */
  note: string;
}

export const SECTIONS: Section[] = [
  { href: "/", label: "Front page", note: "the state of things" },
  { href: "/classes", label: "Classes", note: "grades and outstanding work" },
  { href: "/calendar", label: "Timetable", note: "three weeks of pressure" },
  { href: "/digest", label: "Digest", note: "tonight's notes" },
  { href: "/review", label: "Review", note: "flashcards, when they're due" },
  { href: "/retro", label: "Retro", note: "the week, debriefed" },
  { href: "/routine", label: "Routine", note: "when you're actually free" },
];

/** How long half of a sheet slip runs. Must match the value in `Slip`. */
export const SLIP_MS = 320;
