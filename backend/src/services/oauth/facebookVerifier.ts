import * as jose from "jose";
import type { VerifiedIdentity } from "./types.js";
import { OAuthTokenVerificationError } from "./googleVerifier.js";

const FACEBOOK_JWKS = jose.createRemoteJWKSet(
  new URL("https://www.facebook.com/.well-known/oauth/openid/jwks/"),
);

function resolveFacebookAppId(): string {
  const id =
    process.env.FACEBOOK_APP_ID?.trim() ||
    process.env.META_APP_ID?.trim() ||
    process.env.VITE_FACEBOOK_APP_ID?.trim();
  if (!id) {
    throw new Error("FACEBOOK_APP_ID is not configured");
  }
  return id;
}

function resolveFacebookAppSecret(): string | null {
  return process.env.FACEBOOK_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim() || null;
}

function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

async function verifyFacebookLimitedLoginJwt(idToken: string): Promise<VerifiedIdentity> {
  const appId = resolveFacebookAppId();
  const { payload } = await jose.jwtVerify(idToken, FACEBOOK_JWKS, {
    audience: appId,
  });

  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) {
    throw new OAuthTokenVerificationError("facebook");
  }

  const emailRaw = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  const name = typeof payload.name === "string" ? payload.name.trim() : null;

  return {
    provider: "facebook",
    subject,
    email: emailRaw,
    emailVerified: Boolean(emailRaw),
    displayName: name,
    avatarUrl: null,
  };
}

async function verifyFacebookAccessToken(accessToken: string): Promise<VerifiedIdentity> {
  const appId = resolveFacebookAppId();
  const appSecret = resolveFacebookAppSecret();
  if (!appSecret) {
    throw new Error("FACEBOOK_APP_SECRET is not configured");
  }

  const appToken = `${appId}|${appSecret}`;
  const debugUrl = new URL("https://graph.facebook.com/debug_token");
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set("access_token", appToken);

  const debugRes = await fetch(debugUrl);
  if (!debugRes.ok) {
    throw new OAuthTokenVerificationError("facebook");
  }
  const debugJson = (await debugRes.json()) as {
    data?: { app_id?: string; is_valid?: boolean; user_id?: string };
  };
  const data = debugJson.data;
  if (!data?.is_valid || data.app_id !== appId || !data.user_id) {
    throw new OAuthTokenVerificationError("facebook");
  }

  const meUrl = new URL("https://graph.facebook.com/me");
  meUrl.searchParams.set("fields", "id,name,email");
  meUrl.searchParams.set("access_token", accessToken);
  const meRes = await fetch(meUrl);
  if (!meRes.ok) {
    throw new OAuthTokenVerificationError("facebook");
  }
  const me = (await meRes.json()) as { id?: string; name?: string; email?: string };
  const subject = me.id?.trim() || data.user_id.trim();
  if (!subject) {
    throw new OAuthTokenVerificationError("facebook");
  }

  const email = me.email?.trim().toLowerCase() || null;
  return {
    provider: "facebook",
    subject,
    email,
    emailVerified: Boolean(email),
    displayName: me.name?.trim() || null,
    avatarUrl: null,
  };
}

/**
 * Verify Facebook Limited Login JWT or classic Graph access token.
 * Email may be missing — callers must reject account creation without email.
 */
export async function verifyFacebookIdentity(idToken: string): Promise<VerifiedIdentity> {
  try {
    if (looksLikeJwt(idToken)) {
      return await verifyFacebookLimitedLoginJwt(idToken);
    }
    return await verifyFacebookAccessToken(idToken);
  } catch (err) {
    if (err instanceof OAuthTokenVerificationError) throw err;
    if (err instanceof Error && err.message.includes("not configured")) throw err;
    throw new OAuthTokenVerificationError("facebook");
  }
}
