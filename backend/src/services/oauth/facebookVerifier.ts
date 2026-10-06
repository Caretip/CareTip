import * as jose from "jose";
import type { VerifiedIdentity } from "./types.js";
import { OAuthTokenVerificationError } from "./googleVerifier.js";
import {
  jsonFieldNames,
  logFacebookOAuthDiagnostic,
  type FacebookOAuthDiagnosticCase,
} from "./facebookOAuthDiagnostic.js";

const FACEBOOK_JWKS = jose.createRemoteJWKSet(
  new URL("https://www.facebook.com/.well-known/oauth/openid/jwks/"),
);

export type FacebookVerifyDiagnosticContext = {
  correlationId: string;
};

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

function diagFail(
  diag: FacebookVerifyDiagnosticContext | undefined,
  caseCode: FacebookOAuthDiagnosticCase,
  stage: "failure",
  fields: Record<string, unknown>,
): void {
  if (!diag) return;
  logFacebookOAuthDiagnostic(diag.correlationId, stage, {
    case: caseCode,
    ...fields,
  });
}

async function verifyFacebookLimitedLoginJwt(
  idToken: string,
  diag?: FacebookVerifyDiagnosticContext,
): Promise<VerifiedIdentity> {
  const appId = resolveFacebookAppId();
  if (diag) {
    logFacebookOAuthDiagnostic(diag.correlationId, "identity_verify_jwt", {
      facebookAppId: appId,
    });
  }
  const { payload } = await jose.jwtVerify(idToken, FACEBOOK_JWKS, {
    audience: appId,
  });

  if (diag) {
    logFacebookOAuthDiagnostic(diag.correlationId, "identity_verify_jwt", {
      facebookAppId: appId,
      jwtPayloadFieldNames: jsonFieldNames(payload),
      hasId: typeof payload.sub === "string" && payload.sub.trim().length > 0,
      hasName: typeof payload.name === "string" && payload.name.trim().length > 0,
      hasEmail: typeof payload.email === "string" && payload.email.trim().length > 0,
    });
  }

  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) {
    diagFail(diag, "B", "failure", {
      errorClass: "OAuthTokenVerificationError",
      reason: "jwt_missing_subject",
    });
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

async function verifyFacebookAccessToken(
  accessToken: string,
  diag?: FacebookVerifyDiagnosticContext,
): Promise<VerifiedIdentity> {
  const appId = resolveFacebookAppId();
  const appSecret = resolveFacebookAppSecret();
  if (!appSecret) {
    throw new Error("FACEBOOK_APP_SECRET is not configured");
  }

  if (diag) {
    logFacebookOAuthDiagnostic(diag.correlationId, "identity_verify_access_token", {
      facebookAppId: appId,
    });
  }

  const appToken = `${appId}|${appSecret}`;
  const debugUrl = new URL("https://graph.facebook.com/debug_token");
  debugUrl.searchParams.set("input_token", accessToken);
  debugUrl.searchParams.set("access_token", appToken);

  const debugRes = await fetch(debugUrl);
  const debugJson = (await debugRes.json()) as {
    data?: { app_id?: string; is_valid?: boolean; user_id?: string };
    error?: { message?: string; type?: string; code?: number };
  };
  if (diag) {
    logFacebookOAuthDiagnostic(diag.correlationId, "debug_token_response", {
      graphHttpStatus: debugRes.status,
      responseFieldNames: jsonFieldNames(debugJson),
      debugDataFieldNames: jsonFieldNames(debugJson.data),
      graphErrorFieldNames: jsonFieldNames(debugJson.error),
      tokenValidationSucceeded: Boolean(debugJson.data?.is_valid),
      configuredFacebookAppId: appId,
      metaReportedAppId: debugJson.data?.app_id?.trim() || null,
      debugAppIdMatches: debugJson.data?.app_id === appId,
      facebookUserId: debugJson.data?.user_id?.trim() || null,
      hasAppSecretConfigured: Boolean(appSecret),
    });
  }
  if (!debugRes.ok) {
    diagFail(diag, "C", "failure", {
      errorClass: "OAuthTokenVerificationError",
      graphHttpStatus: debugRes.status,
      reason: "debug_token_http_error",
    });
    throw new OAuthTokenVerificationError("facebook");
  }
  const data = debugJson.data;
  if (!data?.is_valid || data.app_id !== appId || !data.user_id) {
    diagFail(diag, "B", "failure", {
      errorClass: "OAuthTokenVerificationError",
      reason: "debug_token_invalid",
      tokenValidationSucceeded: false,
    });
    throw new OAuthTokenVerificationError("facebook");
  }

  const meUrl = new URL("https://graph.facebook.com/me");
  meUrl.searchParams.set("fields", "id,name,email");
  meUrl.searchParams.set("access_token", accessToken);
  const meRes = await fetch(meUrl);
  const me = (await meRes.json()) as {
    id?: string;
    name?: string;
    email?: string;
    error?: { message?: string; type?: string; code?: number };
  };
  if (diag) {
    logFacebookOAuthDiagnostic(diag.correlationId, "graph_me_response", {
      graphHttpStatus: meRes.status,
      responseFieldNames: jsonFieldNames(me),
      graphErrorFieldNames: jsonFieldNames(me.error),
      hasId: Boolean(me.id?.trim()),
      hasName: Boolean(me.name?.trim()),
      hasEmail: Boolean(me.email?.trim()),
      facebookUserId: me.id?.trim() || data.user_id.trim(),
    });
  }
  if (!meRes.ok) {
    diagFail(diag, "C", "failure", {
      errorClass: "OAuthTokenVerificationError",
      graphHttpStatus: meRes.status,
      reason: "graph_me_http_error",
    });
    throw new OAuthTokenVerificationError("facebook");
  }
  const subject = me.id?.trim() || data.user_id.trim();
  if (!subject) {
    diagFail(diag, "B", "failure", {
      errorClass: "OAuthTokenVerificationError",
      reason: "graph_me_missing_subject",
    });
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
export async function verifyFacebookIdentity(
  idToken: string,
  diag?: FacebookVerifyDiagnosticContext,
): Promise<VerifiedIdentity> {
  if (diag) {
    logFacebookOAuthDiagnostic(diag.correlationId, "identity_verify_route", {
      tokenLooksLikeJwt: looksLikeJwt(idToken),
      hasAppSecretConfigured: Boolean(resolveFacebookAppSecret()),
      configuredFacebookAppId: resolveFacebookAppId(),
    });
  }
  try {
    if (looksLikeJwt(idToken)) {
      return await verifyFacebookLimitedLoginJwt(idToken, diag);
    }
    return await verifyFacebookAccessToken(idToken, diag);
  } catch (err) {
    if (err instanceof OAuthTokenVerificationError) throw err;
    if (err instanceof Error && err.message.includes("not configured")) throw err;
    diagFail(diag, "B", "failure", {
      errorClass: err instanceof Error ? err.name : "Error",
      reason: "verify_unexpected",
    });
    throw new OAuthTokenVerificationError("facebook");
  }
}
