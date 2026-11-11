/**
 * Login email changes. The login email is the account's recovery channel, so whoever controls it
 * controls the account, including an employee's payout links.
 *
 * A change needs the current owner's consent (a link to the existing address, or their password
 * when they ask for it themselves) and then proof of the new address. A manager can only ask.
 *
 * Tokens are single-use and bound to `authTokenVersion`, so a completed change, a password change
 * or a session revocation invalidates anything still pending.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { signPurposeJwt, verifyPurposeJwt } from "../lib/jwtConfig.js";
import { buildAccountSecurityEmail, type AccountSecurityEmailKind } from "../emails/accountSecurityEmail.js";
import { resolveUserPreferredLocale } from "../emails/i18nEmail.js";
import { getResendFromAddress, sendResendEmail } from "./resendClient.js";
import { normalizeLoginEmail } from "./auth.service.js";
import { consumeMfaChallengeJti } from "./mfaLogin.service.js";
import { userMayAuthenticate } from "./accountAccess.service.js";
import { revokeAllRefreshTokensForUser } from "./refreshToken.service.js";
import * as auditService from "./audit.service.js";

const PURPOSE_APPROVE = "email_change_approve";
const PURPOSE_CONFIRM = "email_change_confirm";
const APPROVE_TTL = "24h";
const CONFIRM_TTL = "1h";

export class EmailChangeError extends Error {
  constructor(
    readonly code: "INVALID_TOKEN" | "EMAIL_IN_USE" | "INVALID_EMAIL" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "EmailChangeError";
  }
}

const INVALID_LINK = "This link is invalid or has expired.";

type Claims = {
  purpose: string;
  type: string;
  userId: string;
  oldEmail: string;
  newEmail: string;
  tv: number;
  jti: string;
  requestedBy: string;
};

function frontendBaseUrl(): string {
  return (process.env.FRONTEND_URL?.trim() || "http://localhost:5173").replace(/\/$/, "");
}

function signClaims(purpose: string, ttl: string, claims: Omit<Claims, "purpose" | "type" | "jti">): string {
  return signPurposeJwt(
    purpose,
    { ...claims, purpose, type: purpose, jti: crypto.randomUUID() },
    ttl as jwt.SignOptions["expiresIn"],
  );
}

function linkFor(step: "approve" | "confirm", token: string): string {
  return `${frontendBaseUrl()}/account/email-change/${step}#token=${encodeURIComponent(token)}`;
}

function parseToken(raw: unknown, purpose: string): Claims {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) throw new EmailChangeError("INVALID_TOKEN", INVALID_LINK);
  let decoded: Claims;
  try {
    decoded = verifyPurposeJwt<jwt.JwtPayload & Claims>(purpose, token);
  } catch {
    throw new EmailChangeError("INVALID_TOKEN", INVALID_LINK);
  }
  if (decoded.purpose !== purpose || !decoded.userId || !decoded.newEmail || !decoded.jti) {
    throw new EmailChangeError("INVALID_TOKEN", INVALID_LINK);
  }
  return decoded;
}

async function consumeOnce(jti: string): Promise<void> {
  const consumed = await consumeMfaChallengeJti(`ec:${jti}`);
  if (consumed === "unavailable") throw new EmailChangeError("UNAVAILABLE", "Please try again.");
  if (consumed !== "consumed") throw new EmailChangeError("INVALID_TOKEN", INVALID_LINK);
}

async function sendSecurityEmail(
  kind: AccountSecurityEmailKind,
  to: string,
  locale: string | null | undefined,
  ctaUrl?: string,
): Promise<boolean> {
  const { subject, html, text } = buildAccountSecurityEmail({
    kind,
    locale: resolveUserPreferredLocale(locale ?? null),
    ctaUrl,
  });
  return sendResendEmail(kind, { from: getResendFromAddress(), to: [to], subject, html, text });
}

async function assertEmailFree(email: string, userId: string): Promise<void> {
  const taken = await prisma.user.findFirst({
    where: { email, NOT: { id: userId } },
    select: { id: true },
  });
  if (taken) throw new EmailChangeError("EMAIL_IN_USE", "Email already in use");
}

function assertValidEmail(raw: string): string {
  const email = normalizeLoginEmail(raw);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new EmailChangeError("INVALID_EMAIL", "Invalid email address");
  }
  return email;
}

async function loadOwner(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      preferredLocale: true,
      authTokenVersion: true,
      isActive: true,
      accountStatus: true,
    },
  });
}

/**
 * Someone other than the owner asks to change the owner's login email. Nothing changes here: the
 * owner gets a link at the existing address and can simply ignore it.
 */
export async function requestEmailChangeForOwnerApproval(input: {
  userId: string;
  newEmail: string;
  requestedByUserId: string;
}): Promise<{ pending: boolean }> {
  const newEmail = assertValidEmail(input.newEmail);
  const owner = await loadOwner(input.userId);
  if (!owner || !userMayAuthenticate(owner)) throw new EmailChangeError("INVALID_EMAIL", "Invalid email address");
  if (normalizeLoginEmail(owner.email) === newEmail) return { pending: false };
  await assertEmailFree(newEmail, owner.id);

  const token = signClaims(PURPOSE_APPROVE, APPROVE_TTL, {
    userId: owner.id,
    oldEmail: owner.email,
    newEmail,
    tv: owner.authTokenVersion,
    requestedBy: input.requestedByUserId,
  });
  await sendSecurityEmail("email_change_approve", owner.email, owner.preferredLocale, linkFor("approve", token));
  await auditService.writeAuditLog({
    userId: input.requestedByUserId,
    action: "account.email_change.requested",
    metadata: JSON.stringify({ targetUserId: owner.id, viaOwnerApproval: true }),
  });
  return { pending: true };
}

/** The owner asks themselves, already proven by session and password: only the new address remains. */
export async function requestOwnEmailChange(input: { userId: string; newEmail: string }): Promise<{ pending: boolean }> {
  const newEmail = assertValidEmail(input.newEmail);
  const owner = await loadOwner(input.userId);
  if (!owner || !userMayAuthenticate(owner)) throw new EmailChangeError("INVALID_EMAIL", "Invalid email address");
  if (normalizeLoginEmail(owner.email) === newEmail) return { pending: false };
  await assertEmailFree(newEmail, owner.id);

  const token = signClaims(PURPOSE_CONFIRM, CONFIRM_TTL, {
    userId: owner.id,
    oldEmail: owner.email,
    newEmail,
    tv: owner.authTokenVersion,
    requestedBy: owner.id,
  });
  await sendSecurityEmail("email_change_confirm", newEmail, owner.preferredLocale, linkFor("confirm", token));
  await sendSecurityEmail("email_change_requested", owner.email, owner.preferredLocale);
  await auditService.writeAuditLog({
    userId: owner.id,
    action: "account.email_change.requested",
    metadata: JSON.stringify({ targetUserId: owner.id, viaOwnerApproval: false }),
  });
  return { pending: true };
}

/** The existing address consents. The change still needs proof of the new address. */
export async function approveEmailChange(rawToken: unknown): Promise<void> {
  const claims = parseToken(rawToken, PURPOSE_APPROVE);
  const owner = await loadOwner(claims.userId);
  if (!owner || !userMayAuthenticate(owner) || owner.email !== claims.oldEmail || owner.authTokenVersion !== claims.tv) {
    throw new EmailChangeError("INVALID_TOKEN", INVALID_LINK);
  }
  await consumeOnce(claims.jti);
  await assertEmailFree(claims.newEmail, owner.id);

  const token = signClaims(PURPOSE_CONFIRM, CONFIRM_TTL, {
    userId: owner.id,
    oldEmail: owner.email,
    newEmail: claims.newEmail,
    tv: owner.authTokenVersion,
    requestedBy: claims.requestedBy,
  });
  await sendSecurityEmail("email_change_confirm", claims.newEmail, owner.preferredLocale, linkFor("confirm", token));
  await auditService.writeAuditLog({
    userId: owner.id,
    action: "account.email_change.approved",
    metadata: JSON.stringify({ requestedBy: claims.requestedBy }),
  });
}

/** The new address proves itself. One compare-and-set decides any race, then all access is reset. */
export async function confirmEmailChange(rawToken: unknown): Promise<void> {
  const claims = parseToken(rawToken, PURPOSE_CONFIRM);
  const owner = await loadOwner(claims.userId);
  if (!owner || !userMayAuthenticate(owner) || owner.email !== claims.oldEmail || owner.authTokenVersion !== claims.tv) {
    throw new EmailChangeError("INVALID_TOKEN", INVALID_LINK);
  }
  await consumeOnce(claims.jti);

  let changed = 0;
  try {
    const result = await prisma.user.updateMany({
      where: { id: owner.id, email: claims.oldEmail, authTokenVersion: claims.tv },
      data: { email: claims.newEmail },
    });
    changed = result.count;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EmailChangeError("EMAIL_IN_USE", "Email already in use");
    }
    throw err;
  }
  if (changed !== 1) throw new EmailChangeError("INVALID_TOKEN", INVALID_LINK);

  // Anything issued for the old address must stop working.
  await Promise.all([
    prisma.passwordResetToken.deleteMany({ where: { userId: owner.id } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: owner.id } }),
    prisma.mobileWebHandoffToken.deleteMany({ where: { userId: owner.id } }),
  ]);
  await revokeAllRefreshTokensForUser(owner.id);

  await Promise.all([
    sendSecurityEmail("email_changed", claims.oldEmail, owner.preferredLocale),
    sendSecurityEmail("email_changed", claims.newEmail, owner.preferredLocale),
  ]);
  await auditService.writeAuditLog({
    userId: owner.id,
    action: "account.email_change.completed",
    metadata: JSON.stringify({ requestedBy: claims.requestedBy }),
  });
}

export async function notifySecurityChange(
  kind: Extract<AccountSecurityEmailKind, "mfa_changed" | "mfa_reset_by_admin" | "registration_attempt">,
  to: string,
  locale?: string | null,
): Promise<void> {
  await sendSecurityEmail(kind, to, locale).catch(() => false);
}
