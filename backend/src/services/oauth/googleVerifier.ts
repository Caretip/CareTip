import { OAuth2Client } from "google-auth-library";
import type { VerifiedIdentity } from "./types.js";

export const OAUTH_TOKEN_VERIFICATION_FAILED_CODE = "OAUTH_TOKEN_VERIFICATION_FAILED" as const;

export class OAuthTokenVerificationError extends Error {
  readonly code = OAUTH_TOKEN_VERIFICATION_FAILED_CODE;
  readonly provider: string;

  constructor(provider: string, message = "OAuth token verification failed") {
    super(message);
    this.name = "OAuthTokenVerificationError";
    this.provider = provider;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function resolveGoogleAudiences(): string[] {
  const fromList =
    process.env.GOOGLE_CLIENT_IDS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  if (fromList.length > 0) return fromList;

  const single =
    process.env.GOOGLE_CLIENT_ID?.trim() || process.env.VITE_GOOGLE_CLIENT_ID?.trim();
  if (!single) {
    throw new Error("GOOGLE_CLIENT_ID is not configured");
  }
  return [single];
}

export async function verifyGoogleIdentity(idToken: string): Promise<VerifiedIdentity> {
  const audiences = resolveGoogleAudiences();
  const client = new OAuth2Client();
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new OAuthTokenVerificationError("google");
    }
    const email = payload.email?.trim().toLowerCase() || null;
    const subject = payload.sub?.trim();
    if (!subject) {
      throw new OAuthTokenVerificationError("google");
    }
    if (!email) {
      throw new OAuthTokenVerificationError("google", "Google did not provide an email address");
    }
    return {
      provider: "google",
      subject,
      email,
      emailVerified: payload.email_verified === true,
      displayName: typeof payload.name === "string" ? payload.name.trim() : null,
      avatarUrl: typeof payload.picture === "string" ? payload.picture.trim() : null,
    };
  } catch (err) {
    if (err instanceof OAuthTokenVerificationError) throw err;
    if (err instanceof Error && err.message.includes("not configured")) throw err;
    throw new OAuthTokenVerificationError("google");
  }
}
