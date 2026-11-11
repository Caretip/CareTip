import crypto from "crypto";

/**
 * Application-layer encryption for TOTP secrets, so a database read alone does not defeat MFA.
 * Values stay in the existing text columns. Plain base32 rows from before this change stay readable
 * and are upgraded the next time the code is verified, or by scripts/mfa-secret-reseal.ts.
 *
 * Rotation: set the new key as MFA_SECRET_ENCRYPTION_KEY and the old one as
 * MFA_SECRET_ENCRYPTION_KEY_PREVIOUS. Reads try both; writes use the new key only.
 */
const PREFIX = "enc:v1:";
export const MFA_KEY_MIN_LENGTH = 32;

function deriveKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest();
}

const currentKey = () => deriveKey(process.env.MFA_SECRET_ENCRYPTION_KEY);
const previousKey = () => deriveKey(process.env.MFA_SECRET_ENCRYPTION_KEY_PREVIOUS);

export function isMfaSecretEncryptionConfigured(): boolean {
  return currentKey() !== null;
}

/**
 * A short non-secret label for the current key, logged at startup. Comparing it before a bulk
 * re-encryption proves the operator holds the same key as the running service.
 */
export function mfaKeyFingerprint(): string | null {
  const key = currentKey();
  if (!key) return null;
  return crypto.createHash("sha256").update("caretip-mfa-key-fingerprint").update(key).digest("hex").slice(0, 8);
}

export function isSealedMfaSecret(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Encrypts. Production refuses to store a secret unencrypted rather than quietly downgrading. */
export function sealMfaSecret(plain: string): string {
  const key = currentKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MFA_SECRET_ENCRYPTION_KEY is required to store an MFA secret");
    }
    return plain;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

function decryptWith(key: Buffer, stored: string): string {
  const [iv, tag, body] = stored.slice(PREFIX.length).split(".");
  if (!iv || !tag || !body) throw new Error("Malformed MFA secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** Throws when a sealed value cannot be opened: MFA must fail closed, never fall back to plaintext. */
export function openMfaSecret(stored: string): string {
  if (!isSealedMfaSecret(stored)) return stored;
  const key = currentKey();
  const previous = previousKey();
  if (!key && !previous) throw new Error("MFA_SECRET_ENCRYPTION_KEY is required to read this secret");
  if (key) {
    try {
      return decryptWith(key, stored);
    } catch (err) {
      if (!previous) throw err;
    }
  }
  return decryptWith(previous!, stored);
}

/** True when a stored value is plaintext or sealed with an older key. */
export function needsMfaReseal(stored: string): boolean {
  const key = currentKey();
  if (!key) return false;
  if (!isSealedMfaSecret(stored)) return true;
  try {
    decryptWith(key, stored);
    return false;
  } catch {
    return true;
  }
}
