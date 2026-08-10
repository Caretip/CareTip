import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../prisma.js";
import { normalizeLoginEmail } from "./auth.service.js";
import { validatePassword } from "../utils/passwordValidation.js";
import { getResendFromAddress, sendResendEmail } from "./resendClient.js";
import { resolveEmailPersonalizationForUser } from "../emails/emailPersonalization.js";
import { buildPasswordResetContent, resolveUserPreferredLocale, type EmailLocale } from "../emails/i18nEmail.js";
import { userMayAuthenticate } from "./accountAccess.service.js";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_EXPIRES_HOURS = RESET_TTL_MS / (60 * 60 * 1000);

function hashToken(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

function getFrontendBaseUrl(): string {
  const u = process.env.FRONTEND_URL?.trim();
  if (u) return u.replace(/\/$/, "");
  return "http://localhost:5173";
}

function renderPasswordReset(
  locale: EmailLocale,
  resetUrl: string,
  personalization?: { recipientName?: string | null; businessName?: string | null },
) {
  try {
    return buildPasswordResetContent({
      locale,
      resetUrl,
      expiresInHours: RESET_EXPIRES_HOURS,
      recipientName: personalization?.recipientName,
      businessName: personalization?.businessName,
    });
  } catch {
    return buildPasswordResetContent({
      locale: "en",
      resetUrl,
      expiresInHours: RESET_EXPIRES_HOURS,
      recipientName: personalization?.recipientName,
      businessName: personalization?.businessName,
    });
  }
}

/**
 * Creates a reset token for password-based accounts. OAuth-only users get the same generic success (no enumeration).
 * In development, logs user id only unless PASSWORD_RESET_LOG_DEV_LINK=true (never logs tokens in production).
 */
export async function requestPasswordReset(
  rawEmail: string,
  opts?: {
    acceptLanguage?: string | null;
    explicitLocale?: string | null;
    platform?: "web" | "mobile";
  }
): Promise<void> {
  const email = normalizeLoginEmail(rawEmail);
  if (!email) return;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, preferredLocale: true, isActive: true, accountStatus: true },
  });

  // Generic success for missing/OAuth-only/inactive — no enumeration (F-05).
  if (!user?.passwordHash || !userMayAuthenticate(user)) {
    return;
  }

  const plainToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(plainToken);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    }),
  ]);

  const encoded = encodeURIComponent(plainToken);
  const resetUrl =
    opts?.platform === "mobile"
      ? `caretip://reset-password?token=${encoded}`
      : `${getFrontendBaseUrl()}/reset-password/${encoded}`;

  const from = getResendFromAddress();
  const locale = resolveUserPreferredLocale(
    opts?.explicitLocale ?? user.preferredLocale ?? null,
  );
  const personalization = await resolveEmailPersonalizationForUser(user.id);
  const { subject, html, text } = renderPasswordReset(locale, resetUrl, personalization);

  const ok = await sendResendEmail("password-reset", {
    from,
    to: [email],
    subject,
    html,
    text,
  });
  if (process.env.NODE_ENV !== "production") {
    if (ok) {
      console.info(`[password-reset] Password reset email queued successfully for user ${user.id}`);
    } else if (process.env.PASSWORD_RESET_LOG_DEV_LINK === "true") {
      console.info(
        "[password-reset] (dev) Reset link — configure RESEND_API_KEY to send email:",
        resetUrl,
      );
    } else {
      console.info(
        `[password-reset] Password reset link generated for user ${user.id} (email delivery not configured — set RESEND_API_KEY; use PASSWORD_RESET_LOG_DEV_LINK=true only when you need the full URL in dev logs)`,
      );
    }
  }
}

export async function resetPasswordWithToken(plainToken: string, newPassword: string): Promise<void> {
  const token = String(plainToken ?? "").trim();
  if (!token) {
    throw new Error("Reset link is invalid or has expired.");
  }

  const pw = validatePassword(newPassword);
  if (!pw.valid) {
    throw new Error(pw.message ?? "Invalid password");
  }

  const tokenHash = hashToken(token);
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, isActive: true, accountStatus: true } } },
  });

  if (!row || row.expiresAt < new Date() || !userMayAuthenticate(row.user)) {
    throw new Error("Reset link is invalid or has expired.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.delete({ where: { id: row.id } }),
  ]);
}
