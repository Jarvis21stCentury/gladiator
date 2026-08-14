import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { z } from "zod";
import { toJSONSchema } from "zod";

/**
 * The single provider-agnostic LLM boundary (ARCHITECTURE.md).
 *
 * EVERY vendor SDK call in this app lives in this file. Callers pass a Zod
 * schema and get typed, validated data back — they never see an OpenAI or
 * Anthropic type. Swapping providers is an env var; adding one is a new case in
 * `callProvider` and nothing else.
 */

export type LlmProvider = "openai" | "anthropic";

/**
 * Which tier of model to use. Per ARCHITECTURE.md: cheap/fast for routine
 * structured work (classification, scoring), strong where writing quality
 * actually matters (daily plan, nightly digest, weekly retro).
 */
export type LlmQuality = "fast" | "strong";

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LlmResult<T> {
  data: T;
  provider: LlmProvider;
  model: string;
  usage: LlmUsage;
}

/** An image to send alongside the prompt, for vision-capable models. */
export interface LlmImage {
  /** e.g. "image/jpeg", "image/png". */
  mediaType: string;
  /** Raw base64, no data: prefix. */
  base64: string;
}

export interface GenerateJsonOptions<T extends z.ZodType> {
  /** Short name for the schema — some providers require one. */
  schemaName: string;
  schema: T;
  system: string;
  prompt: string;
  /** Attach images to the user turn. Requires a vision-capable model. */
  images?: LlmImage[];
  quality?: LlmQuality;
  maxOutputTokens?: number;
}

/**
 * Keywords strict structured-output modes reject outright.
 *
 * Zod emits these from ordinary, reasonable validators — `.min(1)` on a string
 * becomes minLength, `.max(40)` on an array becomes maxItems, and even
 * `.int()` emits minimum and maximum for the safe-integer range. A provider in
 * strict mode does not ignore them; it refuses the whole request with a 400.
 *
 * That is a nasty failure because it costs nothing to write and cannot be seen
 * until a real call is made — the flashcard schema carried eight of these and
 * would have failed on the first generation anyone paid for. Stripping them
 * centrally means one place gets it right for every schema, now and later,
 * instead of every author having to remember an undocumented dialect.
 *
 * Nothing of value is lost. These are validators for data the model *produces*,
 * and Zod still enforces them when parsing the response — so a bad value is
 * caught, just on the way back rather than by the provider.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "multipleOf",
  "pattern",
  "format",
  "default",
];

function sanitiseSchema(node: unknown): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;

    const out: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      // Both providers reject `$schema`, and the rest are the strict-mode
      // keywords above.
      if (key === "$schema" || UNSUPPORTED_SCHEMA_KEYWORDS.includes(key)) continue;
      out[key] = walk(child);
    }

    return out;
  };

  return walk(node) as Record<string, unknown>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProvider,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}

// --- Configuration -------------------------------------------------------

function getProvider(): LlmProvider {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();

  // ARCHITECTURE.md: OpenAI by default, Anthropic a one-file swap.
  if (!raw) return "openai";
  if (raw === "openai" || raw === "anthropic") return raw;

  throw new Error(
    `LLM_PROVIDER must be "openai" or "anthropic" (got "${raw}").`,
  );
}

/**
 * Model IDs are env-overridable so a model can be changed without a deploy of
 * this file.
 *
 * ## Both OpenAI tiers point at gpt-4o-mini, deliberately
 *
 * `strong` used to be gpt-4o, and on this workload it was about 85% of the
 * bill: the nightly digest is the only *frequent* strong call — once per class
 * per school day — and gpt-4o costs roughly 16× gpt-4o-mini per input token and
 * 16× per output token. Running the whole app on mini takes it from a few
 * dollars a month to well under one, and this is a personal tool where that
 * ratio matters more than the last increment of prose quality.
 *
 * **The two tiers are kept, not collapsed.** `quality` still selects between two
 * named slots that happen to resolve to the same model today, so restoring the
 * old behaviour is one environment variable — `LLM_MODEL_STRONG=gpt-4o` — and
 * not a hunt through every call site. Deleting the distinction would have made
 * that decision permanent and invisible.
 *
 * What is actually given up: ARCHITECTURE.md reserves the strong tier for the
 * three things a person *reads* rather than scans — the daily-plan narrative,
 * the nightly digest summary and the weekly retro. Those will be written a
 * little more plainly. Everything else in the app was already on mini.
 *
 * Anthropic's pair is untouched and is *not* a cheap default: it puts the
 * digest on Opus. Set LLM_MODEL_STRONG before switching providers.
 */
const DEFAULT_MODELS: Record<LlmProvider, Record<LlmQuality, string>> = {
  openai: { fast: "gpt-4o-mini", strong: "gpt-4o-mini" },
  // Both tiers are Haiku, for the same reason both OpenAI tiers are mini.
  // Opus on this workload — one digest call per class per school day — would
  // cost more per month than a year of the alternative. See RUNAWAY_MODELS.
  anthropic: { fast: "claude-haiku-4-5", strong: "claude-haiku-4-5" },
};

/**
 * Models expensive enough to empty a personal budget before anyone notices.
 *
 * This is a guard, not a judgement about the models. The nightly digest runs
 * once per class per school day unattended, so a frontier model here is not a
 * slightly larger bill — it is one to two orders of magnitude, discovered when
 * the credit runs out mid-term. The failure mode of a *cron job* silently
 * spending money is bad enough to be worth refusing by default.
 *
 * Deliberate use is still one variable away: set LLM_ALLOW_EXPENSIVE_MODELS=1.
 * The point is that it cannot happen by leaving a default alone or mistyping a
 * model name.
 */
const RUNAWAY_MODELS = [/opus/i, /gpt-4\.5/i, /o1-pro/i];

function resolveModel(provider: LlmProvider, quality: LlmQuality): string {
  const override =
    quality === "fast"
      ? process.env.LLM_MODEL_FAST?.trim()
      : process.env.LLM_MODEL_STRONG?.trim();

  const model = override || DEFAULT_MODELS[provider][quality];

  if (
    process.env.LLM_ALLOW_EXPENSIVE_MODELS !== "1" &&
    RUNAWAY_MODELS.some((pattern) => pattern.test(model))
  ) {
    throw new LlmError(
      `Refusing to use "${model}": it is far more expensive than this app's workload assumes, and the digest runs unattended every night. Set LLM_ALLOW_EXPENSIVE_MODELS=1 if you mean it.`,
      provider,
    );
  }

  return model;
}

function requireApiKey(provider: LlmProvider): string {
  const key =
    process.env.LLM_API_KEY?.trim() ||
    (provider === "openai"
      ? process.env.OPENAI_API_KEY?.trim()
      : process.env.ANTHROPIC_API_KEY?.trim());

  if (!key) {
    throw new LlmError(
      `No API key configured for ${provider}. Set LLM_API_KEY (see .env.example).`,
      provider,
    );
  }

  return key;
}

// --- Vendor calls --------------------------------------------------------

interface RawCompletion {
  text: string;
  usage: LlmUsage;
}

async function callOpenAI(
  model: string,
  system: string,
  prompt: string,
  images: LlmImage[],
  schemaName: string,
  jsonSchema: Record<string, unknown>,
  maxOutputTokens: number,
): Promise<RawCompletion> {
  /*
   * `LLM_BASE_URL` points this at any OpenAI-compatible endpoint — Hack Club's
   * free tier for students, an OpenRouter key, a self-hosted proxy. The wire
   * format is identical, so nothing else in this file changes.
   *
   * What such a gateway may not have is *strict structured outputs*: it is an
   * OpenAI feature, and a proxy in front of the same model often does not
   * implement `response_format.json_schema`. `callOpenAI` handles that by
   * retrying without it — see the catch below.
   */
  const client = new OpenAI({
    apiKey: requireApiKey("openai"),
    baseURL: process.env.LLM_BASE_URL?.trim() || undefined,
  });

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
    ...images.map(
      (image): OpenAI.Chat.ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
      }),
    ),
  ];

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: images.length > 0 ? userContent : prompt },
  ];

  /*
   * Strict structured outputs when the endpoint has them, JSON mode when it
   * does not.
   *
   * `json_schema` is an OpenAI feature, and a compatible gateway in front of
   * the same model frequently does not implement it — it answers 400 with
   * something about an unsupported response_format. Falling back keeps every
   * caller working against those endpoints; the schema still gets enforced,
   * just by Zod on the way back rather than by the provider on the way out.
   *
   * The schema is restated in the system prompt for the fallback, because
   * plain JSON mode guarantees only that the reply parses, not its shape.
   */
  const send = (format: OpenAI.Chat.ChatCompletionCreateParams["response_format"]) =>
    client.chat.completions.create({
      model,
      max_completion_tokens: maxOutputTokens,
      messages:
        format?.type === "json_object"
          ? [
              {
                role: "system",
                content: `${system}\n\nReply with JSON only, matching this schema exactly:\n${JSON.stringify(jsonSchema)}`,
              },
              messages[1],
            ]
          : messages,
      response_format: format,
    });

  let response;

  try {
    response = await send({
      type: "json_schema",
      json_schema: { name: schemaName, schema: jsonSchema, strict: true },
    });
  } catch (error) {
    const unsupported =
      error instanceof OpenAI.APIError &&
      error.status === 400 &&
      /response_format|json_schema|not supported|unsupported/i.test(
        error.message ?? "",
      );

    if (!unsupported) throw error;

    response = await send({ type: "json_object" });
  }

  // Guard the shape rather than indexing blind — a proxy or gateway returning an
  // unexpected body should surface as a clear LlmError, not a TypeError.
  const choice = response.choices?.[0];

  if (!choice) {
    throw new LlmError("Response contained no choices.", "openai");
  }

  if (choice?.finish_reason === "length") {
    throw new LlmError(
      "Response hit the output token limit and is incomplete.",
      "openai",
    );
  }

  const text = choice?.message?.content;
  if (!text) {
    throw new LlmError("No content returned.", "openai");
  }

  return {
    text,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? null,
      outputTokens: response.usage?.completion_tokens ?? null,
    },
  };
}

async function callAnthropic(
  model: string,
  system: string,
  prompt: string,
  images: LlmImage[],
  jsonSchema: Record<string, unknown>,
  maxOutputTokens: number,
): Promise<RawCompletion> {
  const client = new Anthropic({ apiKey: requireApiKey("anthropic") });

  // Images before text — Anthropic performs better with the image first.
  const userContent: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (image): Anthropic.ContentBlockParam => ({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: image.base64,
        },
      }),
    ),
    { type: "text", text: prompt },
  ];

  const response = await client.messages.create({
    model,
    // On current models max_tokens caps thinking *plus* the response, so this
    // needs real headroom — a tight limit truncates mid-answer.
    max_tokens: maxOutputTokens,
    system,
    messages: [
      { role: "user", content: images.length > 0 ? userContent : prompt },
    ],
    // Anthropic's format takes the schema only — no name, unlike OpenAI's.
    output_config: {
      format: { type: "json_schema", schema: jsonSchema },
    },
  });

  // Safety classifiers can decline with HTTP 200 — check before reading content.
  if (response.stop_reason === "refusal") {
    throw new LlmError("Request was declined by the model.", "anthropic");
  }

  if (response.stop_reason === "max_tokens") {
    throw new LlmError(
      "Response hit the output token limit and is incomplete.",
      "anthropic",
    );
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text) {
    throw new LlmError("No content returned.", "anthropic");
  }

  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens ?? null,
      outputTokens: response.usage.output_tokens ?? null,
    },
  };
}

// --- Public API ----------------------------------------------------------

/**
 * Ask the model for JSON matching `schema`, and return it parsed and validated.
 * The schema is enforced twice — by the provider's structured-output mode, then
 * by Zod on the way out — so a caller can trust the shape it gets.
 */
export async function generateJson<T extends z.ZodType>({
  schemaName,
  schema,
  system,
  prompt,
  images = [],
  quality = "fast",
  maxOutputTokens = 4000,
}: GenerateJsonOptions<T>): Promise<LlmResult<z.infer<T>>> {
  const provider = getProvider();
  const model = resolveModel(provider, quality);

  // `io: "input"` keeps the schema to what the model must produce, without
  // Zod's output-side transforms leaking in. Both providers reject the
  // `$schema` key, so drop it. Use `z.strictObject` in callers — strict
  // structured-output modes require `additionalProperties: false`.
  const jsonSchema = sanitiseSchema(
    toJSONSchema(schema, { io: "input" }) as Record<string, unknown>,
  );

  let raw: RawCompletion;

  try {
    raw =
      provider === "openai"
        ? await callOpenAI(model, system, prompt, images, schemaName, jsonSchema, maxOutputTokens)
        : await callAnthropic(model, system, prompt, images, jsonSchema, maxOutputTokens);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    throw new LlmError(
      `${provider} request failed: ${error instanceof Error ? error.message : String(error)}`,
      provider,
      { cause: error },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    throw new LlmError(
      `Model returned text that is not valid JSON: ${raw.text.slice(0, 200)}`,
      provider,
    );
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new LlmError(
      `Model output did not match ${schemaName}: ${result.error.message}`,
      provider,
    );
  }

  return { data: result.data, provider, model, usage: raw.usage };
}
