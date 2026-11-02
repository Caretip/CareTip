import { prisma } from "../prisma.js";
import { resolveEmailPersonalizationForUser } from "../emails/emailPersonalization.js";
import {
  buildGenericNotificationContent,
  resolveUserPreferredLocale,
  type EmailLocale,
} from "../emails/i18nEmail.js";
import { getResendFromAddress, sendResendEmailWithOutcome } from "./resendClient.js";
import { buildTrustedAppUrl } from "../config/frontendUrl.js";

/**
 * Email clients cannot open app-relative paths (Gmail turns `/x` into `http:///x`).
 * Returns an absolute link on the trusted FRONTEND_URL origin, or null so the email
 * is sent without a button instead of with a broken one.
 */
export function absoluteEmailActionUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    return buildTrustedAppUrl(value);
  } catch (err) {
    console.error("[email] Notification button omitted: set FRONTEND_URL to the public https:// CareTip origin.", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export type LocalizedNotificationEmailResult = {
  /** Resend accepted the request. Not proof the message reached the inbox. */
  accepted: boolean;
  messageId?: string;
  outcome: "sent" | "retryable" | "permanent" | "not_configured" | "skipped";
};

/**
 * Sends a generic transactional notification email using User.preferredLocale only.
 */
export async function sendLocalizedUserNotificationEmail(input: {
  to: string;
  userId?: string | null;
  preferredLocale?: string | null;
  title: string;
  bodyText: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
}): Promise<LocalizedNotificationEmailResult> {
  const to = input.to.trim().toLowerCase();
  if (!to) return { accepted: false, outcome: "skipped" };

  let stored = input.preferredLocale ?? null;
  if (stored == null && input.userId) {
    const u = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { preferredLocale: true },
    });
    stored = u?.preferredLocale ?? null;
  }

  let locale: EmailLocale = resolveUserPreferredLocale(stored);

  const personalization =
    input.userId != null
      ? await resolveEmailPersonalizationForUser(input.userId)
      : { recipientName: null, businessName: null, accountKind: "other" as const };

  const from = getResendFromAddress();
  let subject: string;
  let html: string;
  let text: string;
  const actionUrl = absoluteEmailActionUrl(input.actionUrl);
  const buildPayload = (loc: EmailLocale) =>
    buildGenericNotificationContent({
      locale: loc,
      title: input.title,
      bodyText: input.bodyText,
      actionUrl,
      actionLabel: input.actionLabel,
      recipientName: personalization.recipientName,
      businessName: personalization.businessName,
    });
  try {
    ({ subject, html, text } = buildPayload(locale));
  } catch {
    locale = "en";
    ({ subject, html, text } = buildPayload("en"));
  }

  const sent = await sendResendEmailWithOutcome("notification", { from, to: [to], subject, html, text });
  if (sent.kind !== "sent" && process.env.NODE_ENV !== "production") {
    console.info("[notification] (dev) Would send to:", to, subject);
  }
  return sent.kind === "sent"
    ? { accepted: true, messageId: sent.messageId, outcome: "sent" }
    : { accepted: false, outcome: sent.kind };
}
