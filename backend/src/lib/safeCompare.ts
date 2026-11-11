import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time secret comparison. Hashing first hides the length of the expected value. */
export function safeSecretEqual(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!actual || !expected) return false;
  const a = createHash("sha256").update(actual).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
