import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";
import { getResendFromAddress, sendResendEmail } from "./resendClient.js";
import { resolveEmailPersonalizationForUser } from "../emails/emailPersonalization.js";
import {
  buildVerifyEmailContent,
  buildWelcomeEmailContent,
  resolveEmailLocale,
  type EmailLocale,
  type WelcomeAccountKind,
} from "../emails/i18nEmail.js";

const VERIFY_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Hours — keep in sync with {@link VERIFY_TTL_MS} for email copy. */
export const VERIFY_EMAIL_EXPIRES_HOURS = VERIFY_TTL_MS / (60 * 60 * 1000);

function hashToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

function getFrontendBaseUrl(): string {
  const u = process.env.FRONTEND_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://localhost:5173";
}

export function buildVerifyEmailUrl(plainToken: string): string {
  const token = String(plainToken ?? "").trim();
  /** Must match SPA route that consumes `token` (see `CheckEmailPage` / `VerifyEmailPage`). */
  return `${getFrontendBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

export async function createEmailVerificationToken(userId: string): Promise<{
  plainToken: string;
  expiresAt: Date;
}> {
  /** Raw token is only sent in email; DB stores SHA-256 hex digest (same shape as employee activation). */
  const plainToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(plainToken);
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS);

  await prisma.$transaction([
    prisma.emailVerificationToken.deleteMany({ where: { userId } }),
    prisma.emailVerificationToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    }),
  ]);

  return { plainToken, expiresAt };
}

function renderVerifyEmail(
  locale: EmailLocale,
  verifyUrl: string,
  personalization?: { recipientName?: string | null; businessName?: string | null },
) {
  try {
    return buildVerifyEmailContent({
      locale,
      verifyUrl,
      expiresInHours: VERIFY_EMAIL_EXPIRES_HOURS,
      recipientName: personalization?.recipientName,
      businessName: personalization?.businessName,
    });
  } catch {
    return buildVerifyEmailContent({
      locale: "en",
      verifyUrl,
      expiresInHours: VERIFY_EMAIL_EXPIRES_HOURS,
      recipientName: personalization?.recipientName,
      businessName: personalization?.businessName,
    });
  }
}

export async function sendEmailVerificationEmail(input: {
  to: string;
  verifyUrl: string;
  locale: EmailLocale;
  userId?: string | null;
}): Promise<void> {
  const to = input.to.trim().toLowerCase();
  if (!to) return;

  const from = getResendFromAddress();
  const loc: EmailLocale = input.locale === "de" ? "de" : "en";
  const personalization = input.userId
    ? await resolveEmailPersonalizationForUser(input.userId)
    : null;
  const { subject, html, text } = renderVerifyEmail(loc, input.verifyUrl, personalization ?? undefined);

  const ok = await sendResendEmail("email-verify", { from, to: [to], subject, html, text });
  if (!ok && process.env.NODE_ENV !== "production") {
    console.info(
      "[email-verify] (dev) Verify email link — configure RESEND_API_KEY to send email:",
      input.verifyUrl,
    );
  }
}

function renderWelcome(
  locale: EmailLocale,
  dashboardUrl: string,
  personalization: {
    recipientName?: string | null;
    businessName?: string | null;
    accountKind?: WelcomeAccountKind;
  },
) {
  try {
    return buildWelcomeEmailContent({
      locale,
      dashboardUrl,
      recipientName: personalization.recipientName,
      businessName: personalization.businessName,
      accountKind: personalization.accountKind,
    });
  } catch {
    return buildWelcomeEmailContent({
      locale: "en",
      dashboardUrl,
      recipientName: personalization.recipientName,
      businessName: personalization.businessName,
      accountKind: personalization.accountKind,
    });
  }
}

export async function sendWelcomeEmail(input: {
  to: string;
  locale: EmailLocale;
  userId?: string | null;
}): Promise<void> {
  const to = input.to.trim().toLowerCase();
  if (!to) return;
  const from = getResendFromAddress();
  const dashboardUrl = `${getFrontendBaseUrl()}/dashboard`;
  const loc: EmailLocale = input.locale === "de" ? "de" : "en";
  const personalization = input.userId
    ? await resolveEmailPersonalizationForUser(input.userId)
    : { recipientName: null, businessName: null, accountKind: "other" as const };
  const { subject, html, text } = renderWelcome(loc, dashboardUrl, personalization);
  const ok = await sendResendEmail("welcome", { from, to: [to], subject, html, text });
  if (!ok && process.env.NODE_ENV !== "production") {
    console.info("[welcome] (dev) Would send welcome to:", to);
  }
}

/** Fire-and-forget welcome mail — logs outcome; never throws to callers (auth-safe). */
export function scheduleWelcomeEmailBestEffort(input: {
  userId: string;
  email: string;
  explicitLocale?: string | null;
  storedLocale?: string | null;
  acceptLanguage?: string | null;
  logContext?: string;
}): void {
  const email = input.email?.trim().toLowerCase();
  if (!email) return;

  const logContext = input.logContext ?? "signup";
  void (async () => {
    try {
      const locale = resolveEmailLocale({
        explicitLocale: input.explicitLocale ?? null,
        storedLocale: input.storedLocale ?? null,
        acceptLanguage: input.acceptLanguage ?? null,
      });
      await sendWelcomeEmail({ to: email, locale, userId: input.userId });
      console.info("[welcome] sent", { userId: input.userId, context: logContext, locale });
    } catch (e) {
      console.error("[welcome] failed", { userId: input.userId, context: logContext }, e);
    }
  })();
}

export async function verifyEmailWithToken(plainToken: string): Promise<void> {
  const token = String(plainToken ?? "").trim();
  if (!token) {
    throw new Error("Verification link is invalid or has expired.");
  }
  const tokenHash = hashToken(token);
  const row = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, email: true, preferredLocale: true } } },
  });
  if (!row || row.expiresAt < new Date()) {
    throw new Error("Verification link is invalid or has expired.");
  }

  // Verify user first, then promote employees — never leave `active` without `email_verified`.
  const pendingEmployees = await prisma.employee.findMany({
    where: {
      userId: row.userId,
      activationStatus: "pending_verification",
    },
    select: { id: true, name: true, businessId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: row.userId },
      data: { emailVerified: true },
    });
    await tx.employee.updateMany({
      where: {
        userId: row.userId,
        activationStatus: "pending_verification",
      },
      data: { activationStatus: "active" },
    });
    await tx.emailVerificationToken.delete({ where: { id: row.id } });
  });

  if (pendingEmployees.length > 0) {
    void import("./activity/staffActivity.helpers.js").then(({ scheduleEmployeeJoinedProjection }) => {
      for (const emp of pendingEmployees) {
        scheduleEmployeeJoinedProjection({
          businessId: emp.businessId,
          employeeId: emp.id,
          employeeName: emp.name,
          employeeEmail: row.user.email,
          channel: "email_verify",
        });
      }
    });
  }

  const email = row.user.email?.trim().toLowerCase();
  if (email) {
    scheduleWelcomeEmailBestEffort({
      userId: row.userId,
      email,
      storedLocale: row.user.preferredLocale,
      logContext: "email_verify",
    });
  }
}
