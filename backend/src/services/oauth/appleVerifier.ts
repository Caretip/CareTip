import * as jose from "jose";
import type { VerifiedIdentity } from "./types.js";
import { OAuthTokenVerificationError } from "./googleVerifier.js";

const APPLE_JWKS = jose.createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

function resolveAppleAudiences(): string[] {
  const fromList =
    process.env.APPLE_CLIENT_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  if (fromList.length > 0) return fromList;

  const single =
    process.env.APPLE_CLIENT_ID?.trim() ||
    process.env.APPLE_SERVICES_ID?.trim() ||
    process.env.APPLE_BUNDLE_ID?.trim();
  if (!single) {
    throw new Error("APPLE_CLIENT_ID is not configured");
  }
  return [single];
}

/**
 * Verify Sign in with Apple identityToken (JWT).
 * Identity is keyed by `sub`. Email may be absent on subsequent logins.
 */
export async function verifyAppleIdentity(idToken: string): Promise<VerifiedIdentity> {
  const audiences = resolveAppleAudiences();
  try {
    const { payload } = await jose.jwtVerify(idToken, APPLE_JWKS, {
      issuer: "https://appleid.apple.com",
      audience: audiences,
    });

    const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
    if (!subject) {
      throw new OAuthTokenVerificationError("apple");
    }

    const emailRaw = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
    const emailVerified =
      payload.email_verified === true ||
      payload.email_verified === "true" ||
      (emailRaw != null && emailRaw.length > 0);

    return {
      provider: "apple",
      subject,
      email: emailRaw,
      emailVerified: Boolean(emailVerified),
      displayName: null,
      avatarUrl: null,
    };
  } catch (err) {
    if (err instanceof OAuthTokenVerificationError) throw err;
    if (err instanceof Error && err.message.includes("not configured")) throw err;
    throw new OAuthTokenVerificationError("apple");
  }
}
