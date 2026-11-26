/**
 * Trusted sign-in device: protects users from being locked out by someone who only knows their email.
 *
 * After a correct password, the browser receives a signed, httpOnly cookie bound to that email and
 * to the account's credential version. Later password attempts that carry a valid, current cookie
 * for the same email use a lockout (and email rate limit) of their own for that device, instead of
 * the email-wide one. Everyone else (an attacker, a new browser, the mobile app, which keeps no
 * cookies) stays on the email-wide lockout, unchanged. See OWASP "Slow brute-force: device cookies".
 *
 * - The cookie proves an earlier correct password on this browser; it grants no session and skips
 *   no check (password and MFA are always verified). Signing out keeps it: the browser stays the
 *   owner's browser.
 * - Credential version: a password reset or change (and any "sign out everywhere") bumps
 *   authTokenVersion, which retires every device cookie issued before. Someone who briefly knew an
 *   old password cannot keep extra guessing budgets from cookies minted back then.
 * - The rate limiter runs before any database read, so it checks only the signature; the password
 *   check (after rate limiting) also checks the credential version. A stale cookie therefore never
 *   escapes the email-wide lockout.
 * - Only issued after a correct password, so having one reveals nothing about registered emails.
 * - One email per browser: signing in with another email replaces it.
 */
import crypto from "node:crypto";
import type { Request } from "express";
import { prisma } from "../prisma.js";
import { firstPartyCookieOptions, parseCookie } from "./refreshToken.service.js";

export const TRUSTED_DEVICE_COOKIE = "caretip_device";
/** Sent only where it is read (sign-in and the password-confirmed verification resend). */
export const TRUSTED_DEVICE_COOKIE_PATH = "/api/auth";
export const TRUSTED_DEVICE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const VERSION = "v2";

function signingKey(): Buffer | null {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) return null;
  // Purpose-bound key: a device cookie can never be confused with a token signed for anything else.
  return crypto.createHmac("sha256", secret).update("caretip:trusted-login-device:v2").digest();
}

function emailTag(normalizedEmail: string): string {
  return crypto.createHash("sha256").update(normalizedEmail).digest("hex").slice(0, 32);
}

function sign(key: Buffer, payload: string): string {
  return crypto.createHmac("sha256", key).update(payload).digest("base64url");
}

export function createTrustedDeviceToken(
  normalizedEmail: string,
  credentialVersion: number,
  deviceId: string = crypto.randomBytes(16).toString("base64url"),
  nowMs = Date.now(),
): string | null {
  const key = signingKey();
  if (!key || !normalizedEmail || !Number.isInteger(credentialVersion) || credentialVersion < 0) return null;
  const payload = `${VERSION}.${emailTag(normalizedEmail)}.${deviceId}.${Math.floor(nowMs / 1000)}.${credentialVersion}`;
  return `${payload}.${sign(key, payload)}`;
}

export type TrustedDeviceClaims = { deviceId: string; credentialVersion: number };

/** Signature, email binding and age only (no database). Null unless all hold. */
export function parseTrustedDeviceToken(token: string | null | undefined, normalizedEmail: string, nowMs = Date.now()): TrustedDeviceClaims | null {
  const key = signingKey();
  if (!key || !token || !normalizedEmail || token.length > 300) return null;
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== VERSION) return null;
  const [, tag, deviceId, iatRaw, versionRaw, signature] = parts as [string, string, string, string, string, string];
  const expected = sign(key, parts.slice(0, 5).join("."));
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (tag !== emailTag(normalizedEmail)) return null;
  const iatMs = Number(iatRaw) * 1000;
  if (!Number.isFinite(iatMs) || iatMs > nowMs + 60_000 || nowMs - iatMs > TRUSTED_DEVICE_MAX_AGE_MS) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) return null;
  const credentialVersion = Number(versionRaw);
  if (!Number.isInteger(credentialVersion) || credentialVersion < 0) return null;
  return { deviceId, credentialVersion };
}

/** Compatibility helper: the device id when signature, binding and age hold (no version check). */
export function verifyTrustedDeviceToken(token: string | null | undefined, normalizedEmail: string, nowMs = Date.now()): string | null {
  return parseTrustedDeviceToken(token, normalizedEmail, nowMs)?.deviceId ?? null;
}

function cookieClaims(req: Pick<Request, "headers">, normalizedEmail: string): TrustedDeviceClaims | null {
  return parseTrustedDeviceToken(parseCookie(req.headers.cookie, TRUSTED_DEVICE_COOKIE), normalizedEmail);
}

/**
 * For the rate limiter (runs before any database read): signature check only. A stale cookie may
 * pick its own email-limit bucket here, but the lockout below still treats it as untrusted.
 */
export function trustedDeviceIdForLogin(req: Pick<Request, "headers">, normalizedEmail: string): string | null {
  return cookieClaims(req, normalizedEmail)?.deviceId ?? null;
}

async function currentCredentialVersion(normalizedEmail: string): Promise<number | null> {
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { authTokenVersion: true } });
  return user ? user.authTokenVersion : null;
}

/** For the lockout: signature AND the account's current credential version (one indexed read). */
export async function verifiedTrustedDeviceIdForLogin(req: Pick<Request, "headers">, normalizedEmail: string): Promise<string | null> {
  const claims = cookieClaims(req, normalizedEmail);
  if (!claims) return null;
  const current = await currentCredentialVersion(normalizedEmail);
  return current !== null && current === claims.credentialVersion ? claims.deviceId : null;
}

/** Issues (or renews, keeping the device id) the cookie after a correct password. */
export async function setTrustedDeviceCookie(
  res: { cookie: (name: string, value: string, opts: Record<string, unknown>) => void },
  normalizedEmail: string,
  deviceId?: string | null,
): Promise<void> {
  const version = await currentCredentialVersion(normalizedEmail);
  if (version === null) return;
  const token = createTrustedDeviceToken(normalizedEmail, version, deviceId ?? undefined);
  if (!token) return;
  res.cookie(TRUSTED_DEVICE_COOKIE, token, {
    ...firstPartyCookieOptions(res),
    path: TRUSTED_DEVICE_COOKIE_PATH,
    maxAge: TRUSTED_DEVICE_MAX_AGE_MS,
  });
}
