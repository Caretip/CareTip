/** IT-Recht XML token auth — load, compare, and safe diagnostics (never log token values). */

export const LEGAL_PROVIDER_TOKEN_ENV = "LEGAL_PROVIDER_TOKEN" as const;

export type ItRechtTokenAuthDiagnostics = {
  envVar: typeof LEGAL_PROVIDER_TOKEN_ENV;
  expectedConfigured: boolean;
  expectedMissing: boolean;
  expectedEmptyAfterTrim: boolean;
  receivedTokenPresent: boolean;
  expectedLength: number;
  receivedLength: number;
  /** True when raw expected value equals its trim (no leading/trailing whitespace). */
  expectedTrimmed: boolean;
  /** True when raw received value equals its trim (no leading/trailing whitespace). */
  receivedTrimmed: boolean;
  /** Strict equality without trimming. */
  tokensIdentical: boolean;
  /** Equality after trimming both sides. */
  equalAfterTrim: boolean;
};

export function loadLegalProviderTokenExpected(): string | undefined {
  const raw = process.env[LEGAL_PROVIDER_TOKEN_ENV];
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildItRechtTokenAuthDiagnostics(receivedToken?: string): ItRechtTokenAuthDiagnostics {
  const expectedRaw = process.env[LEGAL_PROVIDER_TOKEN_ENV] ?? "";
  const receivedRaw = receivedToken ?? "";
  const expectedTrimmedValue = expectedRaw.trim();
  const receivedTrimmedValue = receivedRaw.trim();

  return {
    envVar: LEGAL_PROVIDER_TOKEN_ENV,
    expectedConfigured: expectedTrimmedValue.length > 0,
    expectedMissing: expectedRaw.length === 0,
    expectedEmptyAfterTrim: expectedRaw.length > 0 && expectedTrimmedValue.length === 0,
    receivedTokenPresent: receivedTrimmedValue.length > 0,
    expectedLength: expectedTrimmedValue.length,
    receivedLength: receivedTrimmedValue.length,
    expectedTrimmed: expectedRaw === expectedTrimmedValue,
    receivedTrimmed: receivedRaw === receivedTrimmedValue,
    tokensIdentical: expectedRaw.length > 0 && receivedRaw.length > 0 && expectedRaw === receivedRaw,
    equalAfterTrim:
      expectedTrimmedValue.length > 0 &&
      receivedTrimmedValue.length > 0 &&
      expectedTrimmedValue === receivedTrimmedValue,
  };
}

/** Compare IT-Recht user_auth_token against LEGAL_PROVIDER_TOKEN (both trimmed). */
export function tokensMatchItRechtAuth(receivedToken?: string): boolean {
  const expected = loadLegalProviderTokenExpected();
  if (!expected) return false;
  const received = receivedToken?.trim() ?? "";
  if (!received) return false;
  return received === expected;
}
