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
 * this file. The defaults are the current recommended pair per provider.
 */
const DEFAULT_MODELS: Record<LlmProvider, Record<LlmQuality, string>> = {
  openai: { fast: "gpt-4o-mini", strong: "gpt-4o" },
  anthropic: { fast: "claude-haiku-4-5", strong: "claude-opus-5" },
};

function resolveModel(provider: LlmProvider, quality: LlmQuality): string {
  const override =
    quality === "fast"
      ? process.env.LLM_MODEL_FAST?.trim()
      : process.env.LLM_MODEL_STRONG?.trim();

  return override || DEFAULT_MODELS[provider][quality];
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
  const client = new OpenAI({ apiKey: requireApiKey("openai") });

  const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
    { type: "text", text: prompt },
    ...images.map(
      (image): OpenAI.Chat.ChatCompletionContentPart => ({
        type: "image_url",
        image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
      }),
    ),
  ];

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: maxOutputTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: images.length > 0 ? userContent : prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: schemaName, schema: jsonSchema, strict: true },
    },
  });

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
  const jsonSchema = toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  delete jsonSchema.$schema;

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
