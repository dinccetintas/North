import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * AES-256-GCM for connection tokens (ADR 0008). The key comes from
 * `CONNECTIONS_ENCRYPTION_KEY` (32 bytes, base64). Pure functions; the
 * repository in `connections.ts` stores the three parts.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

export class ConnectionSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionSecretError";
  }
}

export interface SealedSecret {
  readonly ciphertext: string;
  readonly iv: string;
  readonly tag: string;
}

const KeySchema = z.string().min(1);

/** Decodes and checks the key; throws `ConnectionSecretError` when it is missing or the wrong length. */
export function encryptionKey(encoded: string | undefined): Buffer {
  const parsed = KeySchema.safeParse(encoded);
  if (!parsed.success) throw new ConnectionSecretError("CONNECTIONS_ENCRYPTION_KEY is not set");
  const key = Buffer.from(parsed.data, "base64");
  if (key.length !== KEY_BYTES) throw new ConnectionSecretError(`CONNECTIONS_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`);
  return key;
}

/** A fresh random key, base64, for `.env`. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

export function sealSecret(plaintext: string, key: Buffer): SealedSecret {
  if (plaintext.length === 0) throw new ConnectionSecretError("Refusing to store an empty secret");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Object.freeze({ ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") });
}

/** Fails closed: a wrong key, a tampered ciphertext or a bad tag all throw `ConnectionSecretError`. */
export function openSecret(sealed: SealedSecret, key: Buffer): string {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new ConnectionSecretError("Could not decrypt the connection secret (wrong key or corrupted record)");
  }
}
