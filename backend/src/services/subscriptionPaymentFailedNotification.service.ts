/**
 * SUB-004 — Customer email when a platform subscription invoice payment fails.
 *
 * Deduplication policy:
 * - One notification row per (stripeInvoiceId, invoice_payment_failed).
 * - Duplicate webhooks / Stripe retry attempts for the same invoice do not send additional emails.
 * - invoice.payment_succeeded supersedes pending/failed rows for that invoice.
 * - Status `delivered` means Resend accepted the message (HTTP 2xx), not inbox delivery.
 * - Stale `sending` rows (worker crash) are reclaimed after BILLING_NOTIFICATION_SENDING_STALE_MS.
 */
export const BILLING_NOTIFICATION_SENDING_STALE_MS = 10 * 60 * 1000;
import {
  SubscriptionBillingNotificationStatus,
  SubscriptionBillingNotificationType,
  SubscriptionPlanKey,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { resolveCheckoutFrontendBaseUrl } from "../config/frontendUrl.js";
import { isSubscriptionBillingEnabled } from "../config/featureFlags.js";
import { resolveEmailPersonalizationForUser } from "../emails/emailPersonalization.js";
import {
  buildGenericNotificationContent,
  resolveUserPreferredLocale,
} from "../emails/i18nEmail.js";
import { getResendFromAddress, sendResendEmail } from "./resendClient.js";
import { logTrialSync } from "../lib/subscription/trialSyncDebugLog.js";

export type SubscriptionPaymentFailedNotificationInput = {
  businessId: string;
  subscriptionId: string;
  stripeInvoiceId: string;
  stripeEventId: string;
  stripeSubscriptionId: string;
  invoiceAttemptCount: number;
};

function planLabel(planKey: SubscriptionPlanKey, locale: "en" | "de"): string {
  const labels: Record<SubscriptionPlanKey, { en: string; de: string }> = {
    basic: { en: "Basic", de: "Basic" },
    premium: { en: "Pro", de: "Pro" },
    enterprise: { en: "Enterprise", de: "Enterprise" },
  };
  return labels[planKey]?.[locale] ?? planKey;
}

function paymentFailedCopy(
  locale: "en" | "de",
  businessName: string,
  planName: string,
): { title: string; body: string; actionLabel: string } {
  if (locale === "de") {
    return {
      title: "Zahlung für Ihr CareTip-Abonnement fehlgeschlagen",
      body: `Die Zahlung für Ihr ${planName}-Abonnement (${businessName}) konnte nicht verarbeitet werden. Bitte prüfen oder aktualisieren Sie Ihre Zahlungsmethode im Kundenportal, damit Ihr Abonnement aktiv bleibt. Ihr Zugang bleibt vorerst bestehen, während Stripe die Zahlung erneut versucht.`,
      actionLabel: "Abrechnung verwalten",
    };
  }
  return {
    title: "Your CareTip subscription payment failed",
    body: `We could not process the payment for your ${planName} subscription (${businessName}). Please review or update your payment method in the billing portal so your subscription stays active. Your access remains in place while Stripe retries the payment.`,
    actionLabel: "Manage billing",
  };
}

function billingManagementUrl(): string {
  const base = resolveCheckoutFrontendBaseUrl().replace(/\/+$/, "");
  return `${base}/dashboard/billing/subscription`;
}

function resolveLocale(preferred: string | null | undefined): "en" | "de" {
  return preferred?.toLowerCase().startsWith("de") ? "de" : "en";
}

async function resolveManagerRecipient(businessId: string): Promise<{
  email: string | null;
  userId: string | null;
  preferredLocale: string | null;
  businessName: string;
}> {
  const row = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      user: { select: { id: true, email: true, preferredLocale: true } },
    },
  });
  if (!row?.user?.email?.trim()) {
    return { email: null, userId: null, preferredLocale: null, businessName: row?.name ?? "your business" };
  }
  return {
    email: row.user.email.trim().toLowerCase(),
    userId: row.user.id,
    preferredLocale: row.user.preferredLocale,
    businessName: row.name,
  };
}

function sendingStaleCutoff(now = Date.now()): Date {
  return new Date(now - BILLING_NOTIFICATION_SENDING_STALE_MS);
}

/** @internal tests */
export function isSendingNotificationReclaimable(
  status: SubscriptionBillingNotificationStatus,
  updatedAt: Date,
  now = Date.now(),
): boolean {
  if (status !== SubscriptionBillingNotificationStatus.sending) {
    return false;
  }
  return updatedAt.getTime() <= sendingStaleCutoff(now).getTime();
}

async function reclaimStaleSendingNotifications(limit = 50): Promise<number> {
  const cutoff = sendingStaleCutoff();
  const result = await prisma.subscriptionBillingNotification.updateMany({
    where: {
      status: SubscriptionBillingNotificationStatus.sending,
      updatedAt: { lt: cutoff },
    },
    data: {
      status: SubscriptionBillingNotificationStatus.failed,
      lastError: "sending_lease_expired",
    },
  });
  return result.count;
}

async function deliverNotificationRow(notificationId: string): Promise<boolean> {
  const row = await prisma.subscriptionBillingNotification.findUnique({
    where: { id: notificationId },
  });
  if (!row) return false;
  if (
    row.status === SubscriptionBillingNotificationStatus.delivered ||
    row.status === SubscriptionBillingNotificationStatus.superseded ||
    row.status === SubscriptionBillingNotificationStatus.skipped_no_recipient
  ) {
    return row.status === SubscriptionBillingNotificationStatus.delivered;
  }

  const staleCutoff = sendingStaleCutoff();
  const claimed = await prisma.subscriptionBillingNotification.updateMany({
    where: {
      id: notificationId,
      OR: [
        {
          status: {
            in: [
              SubscriptionBillingNotificationStatus.pending,
              SubscriptionBillingNotificationStatus.failed,
            ],
          },
        },
        {
          status: SubscriptionBillingNotificationStatus.sending,
          updatedAt: { lt: staleCutoff },
        },
      ],
    },
    data: { status: SubscriptionBillingNotificationStatus.sending },
  });
  if (claimed.count !== 1) {
    return false;
  }

  const recipient = await resolveManagerRecipient(row.businessId);
  if (!recipient.email) {
    await prisma.subscriptionBillingNotification.update({
      where: { id: notificationId },
      data: {
        status: SubscriptionBillingNotificationStatus.skipped_no_recipient,
        lastError: "no_manager_email",
      },
    });
    logTrialSync("billing.payment_failed_notification.skipped", {
      businessId: row.businessId,
      stripeInvoiceId: row.stripeInvoiceId,
      reason: "no_recipient",
    });
    return false;
  }

  const sub = row.subscriptionId
    ? await prisma.subscription.findUnique({
        where: { id: row.subscriptionId },
        select: { planKey: true },
      })
    : null;
  const planKey = sub?.planKey ?? SubscriptionPlanKey.premium;
  const locale = resolveLocale(recipient.preferredLocale);
  const copy = paymentFailedCopy(locale, recipient.businessName, planLabel(planKey, locale));
  const actionUrl = billingManagementUrl();

  try {
    const locale = resolveUserPreferredLocale(recipient.preferredLocale);
    const personalization =
      recipient.userId != null
        ? await resolveEmailPersonalizationForUser(recipient.userId)
        : { recipientName: null, businessName: recipient.businessName, accountKind: "other" as const };
    const { subject, html, text } = buildGenericNotificationContent({
      locale,
      title: copy.title,
      bodyText: copy.body,
      actionUrl,
      actionLabel: copy.actionLabel,
      recipientName: personalization.recipientName,
      businessName: personalization.businessName ?? recipient.businessName,
    });
    const ok = await sendResendEmail("subscription-payment-failed", {
      from: getResendFromAddress(),
      to: [recipient.email],
      subject,
      html,
      text,
    });
    if (!ok) {
      await prisma.subscriptionBillingNotification.update({
        where: { id: notificationId },
        data: {
          status: SubscriptionBillingNotificationStatus.failed,
          lastError: "resend_not_accepted",
        },
      });
      return false;
    }

    const fresh = await prisma.subscriptionBillingNotification.findUnique({
      where: { id: notificationId },
      select: { status: true },
    });
    if (fresh?.status === SubscriptionBillingNotificationStatus.superseded) {
      return false;
    }

    await prisma.subscriptionBillingNotification.update({
      where: { id: notificationId },
      data: {
        status: SubscriptionBillingNotificationStatus.delivered,
        deliveredAt: new Date(),
        lastError: null,
      },
    });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.subscriptionBillingNotification.update({
      where: { id: notificationId },
      data: {
        status: SubscriptionBillingNotificationStatus.failed,
        lastError: message.slice(0, 500),
      },
    });
    return false;
  }
}

/**
 * After mirror processing for invoice.payment_failed — does not throw (webhook-safe).
 */
export async function handleSubscriptionInvoicePaymentFailedNotification(
  input: SubscriptionPaymentFailedNotificationInput,
): Promise<void> {
  if (!isSubscriptionBillingEnabled()) {
    return;
  }

  try {
    const existing = await prisma.subscriptionBillingNotification.findUnique({
      where: {
        stripeInvoiceId_notificationType: {
          stripeInvoiceId: input.stripeInvoiceId,
          notificationType: SubscriptionBillingNotificationType.invoice_payment_failed,
        },
      },
    });

    if (existing?.status === SubscriptionBillingNotificationStatus.delivered) {
      return;
    }

    let notificationId = existing?.id;
    if (!existing) {
      try {
        const created = await prisma.subscriptionBillingNotification.create({
          data: {
            businessId: input.businessId,
            subscriptionId: input.subscriptionId,
            notificationType: SubscriptionBillingNotificationType.invoice_payment_failed,
            stripeInvoiceId: input.stripeInvoiceId,
            stripeEventId: input.stripeEventId,
            stripeSubscriptionId: input.stripeSubscriptionId,
            invoiceAttemptCount: input.invoiceAttemptCount,
            status: SubscriptionBillingNotificationStatus.pending,
          },
        });
        notificationId = created.id;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code === "P2002") {
          const dup = await prisma.subscriptionBillingNotification.findUnique({
            where: {
              stripeInvoiceId_notificationType: {
                stripeInvoiceId: input.stripeInvoiceId,
                notificationType: SubscriptionBillingNotificationType.invoice_payment_failed,
              },
            },
          });
          notificationId = dup?.id;
          if (dup?.status === SubscriptionBillingNotificationStatus.delivered) {
            return;
          }
        } else {
          throw err;
        }
      }
    }

    if (!notificationId) {
      return;
    }

    await deliverNotificationRow(notificationId);
  } catch (err) {
    logTrialSync("billing.payment_failed_notification.error", {
      businessId: input.businessId,
      stripeInvoiceId: input.stripeInvoiceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function supersedeSubscriptionPaymentFailedNotificationsForInvoice(
  stripeInvoiceId: string,
): Promise<void> {
  const now = new Date();
  await prisma.subscriptionBillingNotification.updateMany({
    where: {
      stripeInvoiceId,
      notificationType: SubscriptionBillingNotificationType.invoice_payment_failed,
      status: {
        in: [
          SubscriptionBillingNotificationStatus.pending,
          SubscriptionBillingNotificationStatus.failed,
          SubscriptionBillingNotificationStatus.sending,
        ],
      },
    },
    data: {
      status: SubscriptionBillingNotificationStatus.superseded,
      supersededAt: now,
    },
  });
}

export type BillingNotificationRetryResult = {
  scanned: number;
  delivered: number;
  failed: number;
  skipped: number;
};

/** Retry failed/pending payment-failure emails (cron-safe). */
export async function retrySubscriptionBillingNotifications(
  limit = 25,
): Promise<BillingNotificationRetryResult> {
  if (!isSubscriptionBillingEnabled()) {
    return { scanned: 0, delivered: 0, failed: 0, skipped: 0 };
  }

  await reclaimStaleSendingNotifications(limit);

  const rows = await prisma.subscriptionBillingNotification.findMany({
    where: {
      notificationType: SubscriptionBillingNotificationType.invoice_payment_failed,
      status: {
        in: [
          SubscriptionBillingNotificationStatus.pending,
          SubscriptionBillingNotificationStatus.failed,
        ],
      },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let delivered = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const ok = await deliverNotificationRow(row.id);
    if (ok) delivered += 1;
    else {
      const after = await prisma.subscriptionBillingNotification.findUnique({
        where: { id: row.id },
        select: { status: true },
      });
      if (after?.status === SubscriptionBillingNotificationStatus.skipped_no_recipient) {
        skipped += 1;
      } else if (after?.status === SubscriptionBillingNotificationStatus.failed) {
        failed += 1;
      }
    }
  }

  return { scanned: rows.length, delivered, failed, skipped };
}

/** @internal tests — assert email HTML does not leak card data. */
export function __buildPaymentFailedCopyForTests(
  locale: "en" | "de",
  businessName: string,
  planKey: SubscriptionPlanKey,
) {
  return paymentFailedCopy(locale, businessName, planLabel(planKey, locale));
}
