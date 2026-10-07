import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { resolvePublicApiBaseUrl } from "../../config/publicApiBaseUrl.js";
import { resolveCheckoutFrontendBaseUrl } from "../../config/frontendUrl.js";
import { logFacebookOAuthDiagnostic } from "./facebookOAuthDiagnostic.js";
import { verifyFacebookIdentity } from "./facebookVerifier.js";

/** OAuth state TTL — must cover slow Facebook consent but stay short. */
export const FACEBOOK_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

/** Completion handoff TTL after callback redirect to SPA. */
export const FACEBOOK_OAUTH_COMPLETION_TTL_MS = 120_000;

const FB_OAUTH_DIALOG_VERSION = "v21.0";
const FB_SCOPES = "email,public_profile";

/**
 * PKCE: not used. CareTip exchanges the authorization code server-side with the app secret
 * (confidential client). Facebook's web code flow for server-side apps does not require PKCE.
 */

export type FacebookOAuthRedirectFlow = "login" | "signup" | "link";

export type FacebookOAuthStatePayload = {
  version: 1;
  flow: FacebookOAuthRedirectFlow;
  correlationId: string;
  isLogin: boolean;
  intendedRole?: "MANAGER" | "EMPLOYEE" | "SUPER_ADMIN";
  name?: string;
  businessName?: string;
  businessType?: string;
  location?: string;
  inviteCode?: string;
  locale?: string;
  merchantLegalAccepted?: boolean;
  /** Authenticated CareTip user initiating account link — never from client body alone. */
  linkUserId?: string;
  /** Server-selected post-flow path (allowlisted). */
  returnPath: string;
};

export type FacebookOAuthCompletionKind = "session" | "mfa" | "link_ok";

const ALLOWED_RETURN_PREFIXES = [
  "/login",
  "/signup",
  "/join",
  "/auth",
  "/employee/login",
  "/business/login",
  "/dashboard",
  "/employee/",
  "/onboarding",
] as const;

function hashToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

function newStateId(): string {
  return randomBytes(32).toString("base64url");
}

function newCompletionPlainToken(): string {
  return randomBytes(32).toString("base64url");
}

export function resolveFacebookOAuthRedirectUri(): string {
  const override = process.env.FACEBOOK_OAUTH_REDIRECT_URI?.trim();
  if (override) return override.replace(/\/$/, "");
  return `${resolvePublicApiBaseUrl()}/api/auth/facebook/callback`;
}

function resolveFacebookAppId(): string {
  const id =
    process.env.FACEBOOK_APP_ID?.trim() ||
    process.env.META_APP_ID?.trim() ||
    process.env.VITE_FACEBOOK_APP_ID?.trim();
  if (!id) throw new Error("FACEBOOK_APP_ID is not configured");
  return id;
}

function resolveFacebookAppSecret(): string {
  const secret =
    process.env.FACEBOOK_APP_SECRET?.trim() || process.env.META_APP_SECRET?.trim();
  if (!secret) throw new Error("FACEBOOK_APP_SECRET is not configured");
  return secret;
}

export function resolveAllowlistedReturnPath(candidate: string | undefined, flow: FacebookOAuthRedirectFlow): string {
  const trimmed = (candidate ?? "").trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return flow === "link" ? "/dashboard/settings" : "/login";
  }
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const ok = ALLOWED_RETURN_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
  if (!ok) {
    if (flow === "link") return "/dashboard/settings";
    return "/login";
  }
  return path.split("?")[0] ?? path;
}

export function buildFacebookAuthorizationUrl(stateId: string): string {
  const appId = resolveFacebookAppId();
  const redirectUri = resolveFacebookOAuthRedirectUri();
  const url = new URL(`https://www.facebook.com/${FB_OAUTH_DIALOG_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", stateId);
  url.searchParams.set("scope", FB_SCOPES);
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function createFacebookOAuthState(input: {
  payload: FacebookOAuthStatePayload;
  createdIp?: string | null;
  createdUserAgent?: string | null;
}): Promise<{ stateId: string; authorizationUrl: string; expiresAt: Date }> {
  const stateId = newStateId();
  const expiresAt = new Date(Date.now() + FACEBOOK_OAUTH_STATE_TTL_MS);
  await prisma.facebookOAuthState.create({
    data: {
      id: stateId,
      payload: input.payload as Prisma.InputJsonValue,
      expiresAt,
      createdIp: input.createdIp?.slice(0, 64) ?? null,
      createdUserAgent: input.createdUserAgent?.slice(0, 512) ?? null,
    },
  });
  logFacebookOAuthDiagnostic(input.payload.correlationId, "facebook_redirect_started", {
    flow: input.payload.flow,
    isLogin: input.payload.isLogin,
    returnPath: input.payload.returnPath,
  });
  return {
    stateId,
    authorizationUrl: buildFacebookAuthorizationUrl(stateId),
    expiresAt,
  };
}

export class FacebookOAuthStateError extends Error {
  readonly code: "invalid" | "expired" | "consumed" | "missing";

  constructor(code: FacebookOAuthStateError["code"], message = "Invalid OAuth state") {
    super(message);
    this.name = "FacebookOAuthStateError";
    this.code = code;
  }
}

export async function consumeFacebookOAuthState(stateId: string): Promise<FacebookOAuthStatePayload> {
  const id = stateId?.trim();
  if (!id || id.length > 128) {
    throw new FacebookOAuthStateError("invalid");
  }
  const now = new Date();
  const rows = await prisma.$queryRaw<
    Array<{ payload: unknown }>
  >`UPDATE "facebook_oauth_states"
    SET "consumed_at" = ${now}
    WHERE "id" = ${id}
      AND "consumed_at" IS NULL
      AND "expires_at" > ${now}
    RETURNING "payload"`;
  if (!rows.length) {
    const existing = await prisma.facebookOAuthState.findUnique({ where: { id } });
    if (!existing) throw new FacebookOAuthStateError("missing");
    if (existing.consumedAt) throw new FacebookOAuthStateError("consumed");
    throw new FacebookOAuthStateError("expired");
  }
  const payload = rows[0]!.payload as FacebookOAuthStatePayload;
  if (payload?.version !== 1 || !payload.correlationId || !payload.flow) {
    throw new FacebookOAuthStateError("invalid");
  }
  return payload;
}

export async function exchangeFacebookAuthorizationCode(
  code: string,
  correlationId: string,
): Promise<string> {
  const redirectUri = resolveFacebookOAuthRedirectUri();
  const appId = resolveFacebookAppId();
  const appSecret = resolveFacebookAppSecret();
  logFacebookOAuthDiagnostic(correlationId, "facebook_code_exchange_started", {
    hasCode: Boolean(code?.trim()),
  });
  const tokenUrl = new URL(`https://graph.facebook.com/${FB_OAUTH_DIALOG_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code.trim());

  const res = await fetch(tokenUrl.toString(), { method: "GET" });
  const json = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error?: { message?: string; type?: string; code?: number };
  };
  logFacebookOAuthDiagnostic(correlationId, "facebook_code_exchange_finished", {
    graphHttpStatus: res.status,
    tokenExchangeSucceeded: Boolean(json.access_token?.trim()),
    hasGraphError: Boolean(json.error),
  });
  if (!res.ok || !json.access_token?.trim()) {
    throw new Error("Facebook code exchange failed");
  }
  return json.access_token.trim();
}

export async function verifyFacebookIdentityFromRedirectCode(
  code: string,
  correlationId: string,
) {
  const accessToken = await exchangeFacebookAuthorizationCode(code, correlationId);
  logFacebookOAuthDiagnostic(correlationId, "facebook_identity_verify_start", {
    channel: "redirect",
  });
  const identity = await verifyFacebookIdentity(accessToken, { correlationId });
  logFacebookOAuthDiagnostic(correlationId, "facebook_identity_verified", {
    facebookUserId: identity.subject,
    hasEmail: Boolean(identity.email),
    hasName: Boolean(identity.displayName),
  });
  return identity;
}

export async function createFacebookOAuthCompletion(input: {
  kind: FacebookOAuthCompletionKind;
  payload: Record<string, unknown>;
  correlationId?: string;
}): Promise<{ plainToken: string; expiresAt: Date }> {
  const plainToken = newCompletionPlainToken();
  const expiresAt = new Date(Date.now() + FACEBOOK_OAUTH_COMPLETION_TTL_MS);
  await prisma.facebookOAuthCompletion.create({
    data: {
      tokenHash: hashToken(plainToken),
      kind: input.kind,
      payload: input.payload as Prisma.InputJsonValue,
      correlationId: input.correlationId?.slice(0, 128) ?? null,
      expiresAt,
    },
  });
  return { plainToken, expiresAt };
}

export class FacebookOAuthCompletionError extends Error {
  readonly code: "invalid" | "expired" | "consumed";

  constructor(code: FacebookOAuthCompletionError["code"]) {
    super("Facebook sign-in handoff is invalid or has expired.");
    this.name = "FacebookOAuthCompletionError";
    this.code = code;
  }
}

export async function consumeFacebookOAuthCompletion(plainToken: string): Promise<{
  kind: FacebookOAuthCompletionKind;
  payload: Record<string, unknown>;
  correlationId: string | null;
}> {
  const token = plainToken?.trim();
  if (!token) throw new FacebookOAuthCompletionError("invalid");
  const tokenHash = hashToken(token);
  const now = new Date();
  const rows = await prisma.$queryRaw<
    Array<{ kind: string; payload: unknown; correlation_id: string | null }>
  >`UPDATE "facebook_oauth_completions"
    SET "consumed_at" = ${now}
    WHERE "token_hash" = ${tokenHash}
      AND "consumed_at" IS NULL
      AND "expires_at" > ${now}
    RETURNING "kind", "payload", "correlation_id"`;
  if (!rows.length) {
    throw new FacebookOAuthCompletionError("expired");
  }
  const row = rows[0]!;
  return {
    kind: row.kind as FacebookOAuthCompletionKind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    correlationId: row.correlation_id,
  };
}

export function buildFrontendCompleteUrl(params: Record<string, string>): string {
  const base = resolveCheckoutFrontendBaseUrl();
  const url = new URL(`${base}/auth/facebook/complete`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

export function newFacebookOAuthCorrelationId(): string {
  return `fb_redirect_${randomBytes(12).toString("hex")}`;
}
