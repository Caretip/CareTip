/**
 * Support-assisted recovery for an employee who has lost their login email.
 *
 * Nobody can do this alone. The steps are:
 *   1. The employee asks. The answer is the same whether or not the account exists.
 *   2. The replacement address proves itself with a single-use link.
 *   3. The existing address is warned and can cancel. A cooling-off period starts.
 *   4. One platform admin records how identity was checked, proving their own factor.
 *   5. A different platform admin approves, proving their own factor.
 *   6. One atomic change swaps the email. Sessions and recovery tokens end. The account row, and so
 *      employment, tips and payout links, stays the same.
 *
 * Runbook: docs/ops/employee-account-recovery.md
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
import { consumeMfaChallengeJti, verifyAndConsumeTotp } from "./mfaLogin.service.js";
import { terminateUserSessions, userMayAuthenticate } from "./accountAccess.service.js";
import { writeAuditLogStrict } from "./audit.service.js";

const PURPOSE_CONFIRM = "account_recovery_confirm";
const PURPOSE_CANCEL = "account_recovery_cancel";
const OPEN = ["awaiting_email_proof", "awaiting_identity_review", "awaiting_approval"];
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_DAY = 3;

export const IDENTITY_METHODS = ["video_call", "government_id_check", "employer_confirmation", "other_documented"] as const;

export function recoveryCoolingOffMs(): number {
  const hours = Number(process.env.ACCOUNT_RECOVERY_COOLING_OFF_HOURS);
  return (Number.isFinite(hours) && hours >= 1 ? hours : 24) * 60 * 60 * 1000;
}

export class AccountRecoveryError extends Error {
  constructor(
    readonly code: "INVALID_TOKEN" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "TOO_EARLY" | "INVALID_INPUT" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "AccountRecoveryError";
  }
}

const INVALID_LINK = "This link is invalid or has expired.";

function frontendBaseUrl(): string {
  return (process.env.FRONTEND_URL?.trim() || "http://localhost:5173").replace(/\/$/, "");
}

async function sendSecurityEmail(kind: AccountSecurityEmailKind, to: string, locale: string | null | undefined, ctaUrl?: string) {
  const { subject, html, text } = buildAccountSecurityEmail({ kind, locale: resolveUserPreferredLocale(locale ?? null), ctaUrl });
  return sendResendEmail(kind, { from: getResendFromAddress(), to: [to], subject, html, text });
}

function linkToken(purpose: string, requestId: string, ttl: jwt.SignOptions["expiresIn"]): string {
  return signPurposeJwt(purpose, { purpose, requestId, jti: crypto.randomUUID() }, ttl);
}

function parseLinkToken(purpose: string, raw: unknown): { requestId: string; jti: string } {
  const token = typeof raw === "string" ? raw.trim() : "";
  try {
    const decoded = verifyPurposeJwt<jwt.JwtPayload & { requestId?: string; jti?: string }>(purpose, token);
    if (!decoded.requestId || !decoded.jti) throw new Error("incomplete");
    return { requestId: decoded.requestId, jti: decoded.jti };
  } catch {
    throw new AccountRecoveryError("INVALID_TOKEN", INVALID_LINK);
  }
}

async function consumeOnce(jti: string): Promise<void> {
  const consumed = await consumeMfaChallengeJti(`ar:${jti}`);
  if (consumed === "unavailable") throw new AccountRecoveryError("UNAVAILABLE", "Please try again.");
  if (consumed !== "consumed") throw new AccountRecoveryError("INVALID_TOKEN", INVALID_LINK);
}

/** Always resolves the same way, so the form cannot be used to discover accounts. */
export async function requestAccountRecovery(input: {
  loginEmail: unknown;
  replacementEmail: unknown;
  statement: unknown;
  ipPrefix?: string | null;
}): Promise<void> {
  const loginEmail = normalizeLoginEmail(typeof input.loginEmail === "string" ? input.loginEmail : "");
  const replacementEmail = normalizeLoginEmail(typeof input.replacementEmail === "string" ? input.replacementEmail : "");
  const statement = typeof input.statement === "string" ? input.statement.trim().slice(0, 2000) : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replacementEmail) || !statement || loginEmail === replacementEmail) {
    throw new AccountRecoveryError("INVALID_INPUT", "Please check the details and try again.");
  }

  const user = await prisma.user.findUnique({
    where: { email: loginEmail },
    select: { id: true, role: true, isActive: true, accountStatus: true, preferredLocale: true },
  });
  // Employees only: a manager or admin account must never change hands through this form.
  if (!user || user.role !== "EMPLOYEE" || !userMayAuthenticate(user)) return;
  if (await prisma.user.findUnique({ where: { email: replacementEmail }, select: { id: true } })) return;

  const now = new Date();
  await prisma.accountRecoveryRequest.updateMany({
    where: { userId: user.id, status: { in: OPEN }, expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  const recent = await prisma.accountRecoveryRequest.count({
    where: { userId: user.id, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  });
  if (recent >= MAX_REQUESTS_PER_DAY) return;

  let requestId: string;
  try {
    const created = await prisma.accountRecoveryRequest.create({
      data: {
        userId: user.id,
        loginEmailAtRequest: loginEmail,
        replacementEmail,
        statement,
        requesterIpPrefix: input.ipPrefix ?? null,
        expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
      },
      select: { id: true },
    });
    requestId = created.id;
  } catch (err) {
    // One open request per account: a second one, however concurrent, changes nothing.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }

  const url = `${frontendBaseUrl()}/account/recovery/confirm#token=${encodeURIComponent(linkToken(PURPOSE_CONFIRM, requestId, "1h"))}`;
  await sendSecurityEmail("account_recovery_confirm", replacementEmail, user.preferredLocale, url);
  await writeAuditLogStrict({
    userId: user.id,
    action: "account.recovery.requested",
    metadata: JSON.stringify({ requestId }),
  });
}

/** The replacement address proves itself. The existing address hears about it and can cancel. */
export async function confirmReplacementEmail(rawToken: unknown): Promise<void> {
  const { requestId, jti } = parseLinkToken(PURPOSE_CONFIRM, rawToken);
  await consumeOnce(jti);
  const now = new Date();
  const moved = await prisma.accountRecoveryRequest.updateMany({
    where: { id: requestId, status: "awaiting_email_proof", expiresAt: { gt: now } },
    data: {
      status: "awaiting_identity_review",
      replacementVerifiedAt: now,
      eligibleAt: new Date(now.getTime() + recoveryCoolingOffMs()),
    },
  });
  if (moved.count !== 1) throw new AccountRecoveryError("INVALID_TOKEN", INVALID_LINK);

  const request = await prisma.accountRecoveryRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { userId: true, loginEmailAtRequest: true, user: { select: { preferredLocale: true } } },
  });
  const url = `${frontendBaseUrl()}/account/recovery/cancel#token=${encodeURIComponent(linkToken(PURPOSE_CANCEL, requestId, "7d"))}`;
  await sendSecurityEmail("account_recovery_warning", request.loginEmailAtRequest, request.user.preferredLocale, url);
  await writeAuditLogStrict({
    userId: request.userId,
    action: "account.recovery.replacement_verified",
    metadata: JSON.stringify({ requestId }),
  });
}

/** Anyone holding the existing address can stop this at any point before completion. */
export async function cancelAccountRecovery(rawToken: unknown): Promise<void> {
  const { requestId, jti } = parseLinkToken(PURPOSE_CANCEL, rawToken);
  await consumeOnce(jti);
  const moved = await prisma.accountRecoveryRequest.updateMany({
    where: { id: requestId, status: { in: OPEN } },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
  if (moved.count !== 1) throw new AccountRecoveryError("INVALID_TOKEN", INVALID_LINK);
  await writeAuditLogStrict({ userId: null, action: "account.recovery.cancelled", metadata: JSON.stringify({ requestId }) });
}

export async function listAccountRecoveryRequests(status?: string) {
  return prisma.accountRecoveryRequest.findMany({
    where: status ? { status } : { status: { in: OPEN } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      userId: true,
      status: true,
      loginEmailAtRequest: true,
      replacementEmail: true,
      statement: true,
      replacementVerifiedAt: true,
      eligibleAt: true,
      expiresAt: true,
      identityMethod: true,
      identityEvidenceRef: true,
      identityVerifiedById: true,
      identityVerifiedAt: true,
      createdAt: true,
    },
  });
}

async function proveAdminFactor(adminUserId: string, code: unknown): Promise<void> {
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { role: true, isPlatformAdmin: true, isActive: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!admin || admin.role !== "SUPER_ADMIN" || !admin.isPlatformAdmin || !admin.isActive || !admin.twoFactorEnabled || !admin.twoFactorSecret) {
    throw new AccountRecoveryError("FORBIDDEN", "Insufficient permissions");
  }
  const check = await verifyAndConsumeTotp(adminUserId, admin.twoFactorSecret, typeof code === "string" ? code : "");
  if (check === "unavailable") throw new AccountRecoveryError("UNAVAILABLE", "Please try again.");
  if (check !== "ok") throw new AccountRecoveryError("FORBIDDEN", "Insufficient permissions");
}

/** First reviewer: records how identity was established. Evidence stays outside this system. */
export async function recordIdentityVerification(input: {
  requestId: string;
  adminUserId: string;
  code: unknown;
  method: unknown;
  evidenceRef: unknown;
}): Promise<void> {
  const method = typeof input.method === "string" ? input.method : "";
  const evidenceRef = typeof input.evidenceRef === "string" ? input.evidenceRef.trim().slice(0, 200) : "";
  if (!(IDENTITY_METHODS as readonly string[]).includes(method) || !evidenceRef) {
    throw new AccountRecoveryError("INVALID_INPUT", "Identity method and evidence reference are required.");
  }
  await proveAdminFactor(input.adminUserId, input.code);
  const now = new Date();
  const moved = await prisma.accountRecoveryRequest.updateMany({
    where: { id: input.requestId, status: "awaiting_identity_review", expiresAt: { gt: now } },
    data: {
      status: "awaiting_approval",
      identityMethod: method,
      identityEvidenceRef: evidenceRef,
      identityVerifiedById: input.adminUserId,
      identityVerifiedAt: now,
    },
  });
  if (moved.count !== 1) throw new AccountRecoveryError("CONFLICT", "This request cannot be reviewed now.");
  await writeAuditLogStrict({
    userId: input.adminUserId,
    action: "account.recovery.identity_verified",
    metadata: JSON.stringify({ requestId: input.requestId, method }),
  });
}

/** Second reviewer. A different person, after cooling-off, in one atomic step. */
export async function approveAccountRecovery(input: {
  requestId: string;
  adminUserId: string;
  code: unknown;
  reason: unknown;
}): Promise<void> {
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";
  if (!reason) throw new AccountRecoveryError("INVALID_INPUT", "A reason is required.");

  const request = await prisma.accountRecoveryRequest.findUnique({
    where: { id: input.requestId },
    include: { user: { select: { id: true, email: true, preferredLocale: true, role: true, isActive: true, accountStatus: true } } },
  });
  if (!request) throw new AccountRecoveryError("NOT_FOUND", "Request not found.");
  if (request.identityVerifiedById === input.adminUserId) {
    throw new AccountRecoveryError("FORBIDDEN", "A second administrator must approve this request.");
  }
  await proveAdminFactor(input.adminUserId, input.code);

  const now = new Date();
  if (request.status !== "awaiting_approval" || request.expiresAt <= now) {
    throw new AccountRecoveryError("CONFLICT", "This request cannot be approved now.");
  }
  if (!request.eligibleAt || request.eligibleAt > now) {
    throw new AccountRecoveryError("TOO_EARLY", "The cooling-off period has not ended.");
  }
  if (request.user.role !== "EMPLOYEE" || !userMayAuthenticate(request.user) || request.user.email !== request.loginEmailAtRequest) {
    throw new AccountRecoveryError("CONFLICT", "This account has changed since the request.");
  }

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.accountRecoveryRequest.updateMany({
        where: { id: request.id, status: "awaiting_approval" },
        data: { status: "completed", approvedById: input.adminUserId, approvedAt: now, approvalReason: reason },
      });
      if (claimed.count !== 1) throw new AccountRecoveryError("CONFLICT", "This request cannot be approved now.");
      const swapped = await tx.user.updateMany({
        where: { id: request.userId, email: request.loginEmailAtRequest },
        data: { email: request.replacementEmail, emailVerified: true },
      });
      if (swapped.count !== 1) throw new AccountRecoveryError("CONFLICT", "This account has changed since the request.");
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AccountRecoveryError("CONFLICT", "The replacement email is now in use.");
    }
    throw err;
  }

  await terminateUserSessions(request.userId);
  await writeAuditLogStrict({
    userId: input.adminUserId,
    action: "account.recovery.completed",
    metadata: JSON.stringify({ requestId: request.id, targetUserId: request.userId, identityVerifiedById: request.identityVerifiedById, reason }),
  });
  await Promise.all([
    sendSecurityEmail("email_changed", request.loginEmailAtRequest, request.user.preferredLocale),
    sendSecurityEmail("email_changed", request.replacementEmail, request.user.preferredLocale),
  ]);
}

export async function rejectAccountRecovery(input: { requestId: string; adminUserId: string; reason: unknown }): Promise<void> {
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 1000) : "";
  if (!reason) throw new AccountRecoveryError("INVALID_INPUT", "A reason is required.");
  const moved = await prisma.accountRecoveryRequest.updateMany({
    where: { id: input.requestId, status: { in: OPEN } },
    data: { status: "rejected", rejectedById: input.adminUserId, rejectedAt: new Date(), rejectionReason: reason },
  });
  if (moved.count !== 1) throw new AccountRecoveryError("CONFLICT", "This request is no longer open.");
  await writeAuditLogStrict({
    userId: input.adminUserId,
    action: "account.recovery.rejected",
    metadata: JSON.stringify({ requestId: input.requestId, reason }),
  });
}
