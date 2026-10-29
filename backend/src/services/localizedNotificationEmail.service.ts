import { prisma } from "../prisma.js";
import { resolveEmailPersonalizationForUser } from "../emails/emailPersonalization.js";
import {
  buildGenericNotificationContent,
  resolveUserPreferredLocale,
  type EmailLocale,
} from "../emails/i18nEmail.js";
import { getResendFromAddress, sendResendEmailWithOutcome } from "./resendClient.js";

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
  const buildPayload = (loc: EmailLocale) =>
    buildGenericNotificationContent({
      locale: loc,
      title: input.title,
      bodyText: input.bodyText,
      actionUrl: input.actionUrl,
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
