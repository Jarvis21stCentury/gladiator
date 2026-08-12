import "server-only";

import { canStoreSecrets, decryptSecret, encryptSecret } from "@/lib/crypto/secret";
import { prisma } from "@/lib/prisma";

import type { HacCredentials } from "./client";

/**
 * Stored Home Access Center credentials.
 *
 * Unlike Canvas and Google, this is a *password*, not a revocable token — see
 * `lib/crypto/secret.ts` for what encrypting it does and does not buy. It lives
 * in the same `Setting` table as the others, with the password encrypted and the
 * username and URL in the clear (neither is a secret, and seeing them is how you
 * confirm you connected the right account).
 */

export const HAC_KEYS = {
  baseUrl: "HAC_BASE_URL",
  username: "HAC_USERNAME",
  password: "HAC_PASSWORD_ENC",
} as const;

export interface HacStatus {
  connected: boolean;
  /** False when CREDENTIAL_SECRET is missing — storing a password is refused. */
  available: boolean;
  baseUrl: string | null;
  username: string | null;
}

export async function getHacStatus(): Promise<HacStatus> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(HAC_KEYS) } },
  });

  const stored = new Map(rows.map((row) => [row.key, row.value]));

  return {
    connected: Object.values(HAC_KEYS).every((key) => stored.has(key)),
    available: canStoreSecrets(),
    baseUrl: stored.get(HAC_KEYS.baseUrl) ?? null,
    username: stored.get(HAC_KEYS.username) ?? null,
  };
}

/** Null when nothing is stored. Decrypts the password — server only. */
export async function getHacCredentials(): Promise<HacCredentials | null> {
  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(HAC_KEYS) } },
  });

  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const baseUrl = stored.get(HAC_KEYS.baseUrl);
  const username = stored.get(HAC_KEYS.username);
  const encrypted = stored.get(HAC_KEYS.password);

  if (!baseUrl || !username || !encrypted) return null;

  return { baseUrl, username, password: decryptSecret(encrypted) };
}

export async function saveHacCredentials(input: HacCredentials): Promise<void> {
  // Throws when CREDENTIAL_SECRET is unset, which is the intended behaviour:
  // storing a school password in plaintext is not a fallback worth having.
  const encrypted = encryptSecret(input.password);

  const write = (key: string, value: string) =>
    prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });

  await prisma.$transaction([
    write(HAC_KEYS.baseUrl, input.baseUrl),
    write(HAC_KEYS.username, input.username),
    write(HAC_KEYS.password, encrypted),
  ]);
}

export async function clearHacCredentials(): Promise<void> {
  await prisma.setting.deleteMany({
    where: { key: { in: Object.values(HAC_KEYS) } },
  });
}
