import type { Metadata } from "next";
import { Instrument_Serif, Familjen_Grotesk, Spline_Sans_Mono } from "next/font/google";

import { Colophon } from "@/components/press/Colophon";
import { Masthead } from "@/components/press/Masthead";
import { Press } from "@/components/press/Press";
import { Slip } from "@/components/press/Slip";
import { Throughline } from "@/components/press/Throughline";
import { getAmbientLevel } from "@/lib/system-state";
import "./globals.css";

/*
 * The type system. See CLAUDE.md — three faces, three jobs, no overlap.
 *
 * Instrument Serif is the display face: very high stroke contrast, editorial,
 * and it only gets better the larger it is set, which suits an almanac where the
 * figure is the content. Familjen Grotesk carries body copy and every piece of
 * UI — quiet, warm, and comfortable at 11pm. Spline Sans Mono is docket type
 * only: serials, timestamps, provenance. Hard rule from CLAUDE.md: paragraphs
 * never live in the mono, and the digest and retro are why.
 *
 * All three load through `next/font`, so they are self-hosted, preloaded and
 * cause no layout shift — nothing to fail on a slow connection.
 */
const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
});

const familjen = Familjen_Grotesk({
  variable: "--font-familjen",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Gladiator — an almanac",
  description: "Personal school command center.",
};

/*
 * Runs before first paint and does exactly one thing: mark that scripting is
 * alive. Every hidden pre-animation state in globals.css is scoped to `html.js`,
 * so if this never runs — a blocked script, an ancient browser, a broken
 * bundle — nothing is hidden and the whole almanac renders as static type.
 * Content that only exists once JavaScript has agreed to reveal it is the single
 * most common way a page like this ends up blank.
 */
const ENABLE_MOTION = `document.documentElement.classList.add("js")`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // One indexed query. The through-line in the margin is inked by this on every
  // page, so the system's state stays visible wherever you have navigated to.
  const level = await getAmbientLevel();

  return (
    <html
      lang="en"
      className={`${instrument.variable} ${familjen.variable} ${splineMono.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ENABLE_MOTION }} />
      </head>
      <body className="flex min-h-full flex-col">
        <Throughline />
        <Press level={level} />

        <Masthead />
        {children}
        <Colophon />

        <Slip />
      </body>
    </html>
  );
}
