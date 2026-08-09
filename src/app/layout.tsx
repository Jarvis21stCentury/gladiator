import type { Metadata } from "next";
import { Archivo, Hanken_Grotesk, DM_Mono } from "next/font/google";

import { Colophon } from "@/components/press/Colophon";
import { courseColorVars } from "@/lib/courses/color";
import { Press } from "@/components/press/Press";
import { Sidebar } from "@/components/press/Sidebar";
import { Slip } from "@/components/press/Slip";
import { getShellData } from "@/lib/system-state";
import "./globals.css";

/*
 * The type system. See CLAUDE.md — three faces, three jobs, no overlap.
 *
 * Archivo is the display face, and it is here for its *width* axis. Loaded as a
 * variable font with `wdth` exposed, it runs from condensed to 125% expanded,
 * and the design sets headings at 115 and hero figures at 125 — squared,
 * confident, scoreboard type. That axis is the design element the previous
 * display serif's italic used to be; a high-contrast bookish serif read as
 * archival, and the brief here is a semester in progress.
 *
 * Hanken Grotesk carries body copy and every piece of UI: humanist, open, and
 * genuinely comfortable at 14px and at 11pm, which the two text-heavy pages
 * need. DM Mono is docket type only — serials, timestamps, provenance. Hard
 * rule from CLAUDE.md: paragraphs never live in the mono, and the digest and
 * the retro are why.
 *
 * All three load through `next/font`, so they are self-hosted, preloaded and
 * cause no layout shift — nothing to fail on a slow connection.
 */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  // No `weight`: this is the variable cut, which is what makes `wdth`
  // available. Naming a static weight would silently drop the axis and every
  // heading in the product would fall back to normal width.
  axes: ["wdth"],
});

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Gladiator — the notebook",
  description: "Personal school command center.",
};

/*
 * Runs before first paint and does exactly one thing: mark that scripting is
 * alive. Every hidden pre-animation state in globals.css is scoped to `html.js`,
 * so if this never runs — a blocked script, an ancient browser, a broken
 * bundle — nothing is hidden and the whole page renders as static type.
 * Content that only exists once JavaScript has agreed to reveal it is the single
 * most common way a page like this ends up blank.
 */
const ENABLE_MOTION = `document.documentElement.classList.add("js")`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Three indexed queries, once, for the shell. The sidebar is on every page,
  // so the class list and the overdue count stay visible wherever you navigate.
  const { level, overdue, courses } = await getShellData();

  return (
    <html
      lang="en"
      className={`${archivo.variable} ${hanken.variable} ${dmMono.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ENABLE_MOTION }} />
        {/*
          One class → one colour, emitted once for the whole document. See
          lib/courses/color.ts for why this is a map rather than a hash: with
          eight colours and six classes, hashing collided about 78% of the time
          and three classes rendered identically.
        */}
        <style dangerouslySetInnerHTML={{ __html: courseColorVars(courses) }} />
      </head>
      <body>
        <Press level={level} />

        {/* The shell: a persistent sidebar and a scrolling content column. The
            content column is its own flex context so a short page still pins
            the colophon to the bottom rather than leaving it mid-screen. */}
        <div className="app">
          <Sidebar level={level} overdue={overdue} courses={courses} />

          <div className="flex min-h-dvh flex-col">
            {children}
            <Colophon />
          </div>
        </div>

        <Slip />
      </body>
    </html>
  );
}
