import "server-only";

import { z } from "zod";

import { generateJson } from "@/lib/llm";
import type { DetectedStruggle } from "./detect";

/**
 * Turns a detected pattern into the "plain-English explanation, not just a red
 * dot" FEATURES.md asks for.
 *
 * This is the only part of the struggles engine that touches a model, and it is
 * deliberately the last step: the rules have already written a correct sentence
 * by the time this runs. If the call fails — no key, rate limit, bad JSON — the
 * caller keeps the rules text. A struggle flag that appears late is a bug; one
 * that reads a little flatly is not.
 *
 * The model is given the evidence and told it may not add anything to it. It is
 * rewriting known facts, not diagnosing.
 */

const ExplanationSchema = z.strictObject({
  explanations: z.array(
    z.strictObject({
      signature: z.string(),
      description: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `You explain patterns detected in one student's schoolwork.

Each item comes with a signature, a detected pattern, and the exact evidence it was detected from. Rewrite each one as an explanation the student can act on.

Rules:
- Two or three sentences. Say what is happening, then the one thing to do about it.
- Use only the supplied evidence. Do not add causes, feelings, or assignments that are not listed. You do not know why it happened.
- Address the student directly. No greetings, no headers, no encouragement padding.
- Keep every number exactly as given. Do not round or restate them differently.
- Return the same signature you were given, unchanged, for every item.`;

function describe(struggle: DetectedStruggle): string {
  return [
    `signature: ${struggle.signature}`,
    `pattern: ${struggle.type}`,
    `headline: ${struggle.title}`,
    `evidence:`,
    ...struggle.evidence.map((line) => `  - ${line}`),
  ].join("\n");
}

export interface ExplainResult {
  /** signature → rewritten description. Missing keys keep the rules text. */
  descriptions: Map<string, string>;
  /** Null when the model was never reached. */
  error: string | null;
}

export async function explainStruggles(
  struggles: DetectedStruggle[],
): Promise<ExplainResult> {
  if (struggles.length === 0) {
    return { descriptions: new Map(), error: null };
  }

  try {
    const result = await generateJson({
      schemaName: "struggle_explanations",
      schema: ExplanationSchema,
      system: SYSTEM_PROMPT,
      prompt: struggles.map(describe).join("\n\n"),
      // ARCHITECTURE.md: classification-shaped work runs on the cheap model.
      // The rules did the judgement; this is a rewrite.
      quality: "fast",
      maxOutputTokens: 2000,
    });

    const known = new Set(struggles.map((struggle) => struggle.signature));

    return {
      descriptions: new Map(
        result.data.explanations
          // A signature we never sent is a hallucinated flag; dropping it here
          // means it can't be written against some other struggle's row.
          .filter((item) => known.has(item.signature))
          .map((item) => [item.signature, item.description.trim()]),
      ),
      error: null,
    };
  } catch (error) {
    return {
      descriptions: new Map(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
