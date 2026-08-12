import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Reversible encryption for a credential the server has to be able to *use*.
 *
 * Every other secret in this app is a revocable token: a Canvas access token, a
 * Google refresh token. Revoke it from the issuing service and it is dead,
 * whatever this database contains. A HAC password is not like that. It is the
 * student's actual district login, it cannot be scoped, and there is no button
 * anywhere that turns one instance of it off.
 *
 * So it is encrypted at rest. Be clear-eyed about what that buys: the server
 * must be able to log in as you, so it must be able to decrypt, so the key is
 * on the same machine. This is not a vault. What it does defend against is the
 * realistic failure — a database dump, a stray backup, a screenshot of a table —
 * putting a working school password in plain sight.
 *
 * AES-256-GCM, so tampering is detected rather than silently decrypting to
 * rubbish. The key is derived from `CREDENTIAL_SECRET` with scrypt, which means
 * that env var can be an ordinary passphrase instead of exactly 32 bytes.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/**
 * Fixed salt, and that is a deliberate, bounded compromise.
 *
 * A random per-record salt would mean storing it alongside the ciphertext and
 * re-deriving the key on every read. scrypt is intentionally slow, so that
 * would put ~100ms on every credential read. The realistic threat here is a
 * leaked database, not a rainbow-table attack on a single-user passphrase, and
 * the salt is not what defends against the former.
 */
const SALT = "gladiator.credential.v1";

export class MissingCredentialSecretError extends Error {
  constructor() {
    super(
      "CREDENTIAL_SECRET is not set. Add a long random string to .env before storing a password — see .env.example.",
    );
    this.name = "MissingCredentialSecretError";
  }
}

/** Whether this deployment is able to store a password at all. */
export function canStoreSecrets(): boolean {
  return Boolean(process.env.CREDENTIAL_SECRET?.trim());
}

function key(): Buffer {
  const secret = process.env.CREDENTIAL_SECRET?.trim();

  // Refusing is the point. Falling back to a default key, or to plaintext,
  // would mean a password stored in a way the student was never told about.
  if (!secret) throw new MissingCredentialSecretError();

  return scryptSync(secret, SALT, KEY_LENGTH);
}

/** `iv.ciphertext.tag`, all base64url — one opaque string to store. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return [
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptSecret(stored: string): string {
  const [ivPart, dataPart, tagPart] = stored.split(".");

  if (!ivPart || !dataPart || !tagPart) {
    throw new Error("Stored credential is malformed.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
