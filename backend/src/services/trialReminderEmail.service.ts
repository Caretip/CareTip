import { Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { queueLocalizedUserNotificationEmail } from "./localizedNotificationEmail.service.js";
import { isSubscriptionTrialEnabled } from "../config/subscriptionTrial.js";

export type TrialReminderDay = "7" | "3" | "1";

export type TrialRemindersSent = Partial<Record<TrialReminderDay, string>>;

const REMINDER_DAYS: TrialReminderDay[] = ["7", "3", "1"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Subscription billing page (the route `/dashboard/billing` redirects here). */
export const TRIAL_REMINDER_BILLING_PATH = "/dashboard/billing/subscription";

function parseRemindersSent(raw: unknown): TrialRemindersSent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TrialRemindersSent = {};
  for (const day of REMINDER_DAYS) {
    const value = (raw as Record<string, unknown>)[day];
    if (typeof value === "string" && value.trim()) {
      out[day] = value;
    }
  }
  return out;
}

function daysUntilTrialEnd(trialEndsAt: Date): number {
  return Math.ceil((trialEndsAt.getTime() - Date.now()) / MS_PER_DAY);
}

function reminderCopy(day: TrialReminderDay, locale: "en" | "de"): { title: string; body: string } {
  const en: Record<TrialReminderDay, { title: string; body: string }> = {
    "7": {
      title: "Your CareTip trial ends in 7 days",
      body: "Your free trial ends in one week. Your saved payment method will be charged automatically when the trial ends unless you cancel before then.",
    },
    "3": {
      title: "Your CareTip trial ends in 3 days",
      body: "Your free trial ends in three days. Cancel anytime before the trial ends to avoid being charged.",
    },
    "1": {
      title: "Your CareTip trial ends tomorrow",
      body: "Your free trial ends tomorrow. Your subscription will renew automatically unless you cancel before the trial ends.",
    },
  };
  const de: Record<TrialReminderDay, { title: string; body: string }> = {
    "7": {
      title: "Ihre CareTip-Testphase endet in 7 Tagen",
      body: "Ihre kostenlose Testphase endet in einer Woche. Ihre hinterlegte Zahlungsmethode wird am Ende der Testphase automatisch belastet, sofern Sie nicht vorher kündigen.",
    },
    "3": {
      title: "Ihre CareTip-Testphase endet in 3 Tagen",
      body: "Ihre kostenlose Testphase endet in drei Tagen. Kündigen Sie jederzeit vor Ablauf, um eine Belastung zu vermeiden.",
    },
    "1": {
      title: "Ihre CareTip-Testphase endet morgen",
      body: "Ihre kostenlose Testphase endet morgen. Ihr Abonnement verlängert sich automatisch, sofern Sie nicht vor Ablauf kündigen.",
    },
  };
  return locale === "de" ? de[day] : en[day];
}

function resolveLocale(preferred: string | null | undefined): "en" | "de" {
  return preferred?.toLowerCase().startsWith("de") ? "de" : "en";
}

export type TrialReminderRunResult = {
  scanned: number;
  sent: number;
  skipped: number;
};

/**
 * Send 7 / 3 / 1-day trial ending reminders for trialing subscriptions.
 * Uses mirrored Stripe `trialEndsAt` (not checkout+N). Idempotent via `trialReminderSent`.
 * Skips cancel_at_period_end trials — they will not auto-convert to paid.
 * One subscription failure does not abort the rest of the run.
 */
export async function runTrialReminderEmails(): Promise<TrialReminderRunResult> {
  if (!isSubscriptionTrialEnabled()) {
    return { scanned: 0, sent: 0, skipped: 0 };
  }

  const now = new Date();
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: SubscriptionStatus.trialing,
      trialEndsAt: { gt: now },
      // Already scheduled not to renew — do not warn about an upcoming automatic charge.
      cancelAtPeriodEnd: false,
    },
    select: {
      id: true,
      businessId: true,
      trialEndsAt: true,
      trialReminderSent: true,
      business: {
        select: {
          name: true,
          user: { select: { id: true, email: true, preferredLocale: true } },
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;

  for (const sub of subscriptions) {
    try {
      if (!sub.trialEndsAt) {
        skipped += 1;
        continue;
      }

      const daysLeft = daysUntilTrialEnd(sub.trialEndsAt);
      const dueDay = REMINDER_DAYS.find((d) => daysLeft === Number(d));
      if (!dueDay) {
        skipped += 1;
        continue;
      }

      const sentMap = parseRemindersSent(sub.trialReminderSent);
      if (sentMap[dueDay]) {
        skipped += 1;
        continue;
      }

      const manager = sub.business.user;
      if (!manager?.email) {
        skipped += 1;
        continue;
      }

      const locale = resolveLocale(manager.preferredLocale);
      const copy = reminderCopy(dueDay, locale);

      // Claim the reminder before sending so a second job run cannot send it too.
      // The claim only matches while the column still holds what this run read.
      const updatedSent: TrialRemindersSent = {
        ...sentMap,
        [dueDay]: now.toISOString(),
      };
      const unchanged =
        sub.trialReminderSent == null
          ? { equals: Prisma.AnyNull }
          : { equals: sub.trialReminderSent as Prisma.InputJsonValue };
      const claim = await prisma.subscription.updateMany({
        where: { id: sub.id, trialReminderSent: unchanged },
        data: { trialReminderSent: updatedSent },
      });
      if (claim.count === 0) {
        skipped += 1;
        continue;
      }

      // Durable: once the reminder is in the delivery outbox, the queue worker retries it until
      // Resend accepts it, so a Resend outage on reminder day no longer loses it.
      const delivery = await queueLocalizedUserNotificationEmail({
        to: manager.email,
        userId: manager.id,
        preferredLocale: manager.preferredLocale,
        title: copy.title,
        bodyText: copy.body,
        actionUrl: TRIAL_REMINDER_BILLING_PATH,
        actionLabel: locale === "de" ? "Abrechnung öffnen" : "Open billing",
        idempotencyKey: `trial-reminder:${sub.id}:${dueDay}`,
        kind: "trial_reminder",
        businessId: sub.businessId,
      });
      const result =
        delivery.mode === "direct"
          ? delivery.result
          : { accepted: delivery.mode === "queued", outcome: delivery.mode };

      if (!result.accepted) {
        // Not delivered: release the claim so the next run tries again.
        await prisma.subscription.updateMany({
          where: { id: sub.id, trialReminderSent: { equals: updatedSent } },
          data: {
            trialReminderSent:
              sub.trialReminderSent == null ? Prisma.DbNull : (sub.trialReminderSent as Prisma.InputJsonValue),
          },
        });
        console.warn("[trial-reminder] email not accepted; will retry on the next run", {
          subscriptionId: sub.id,
          day: dueDay,
          outcome: result.outcome,
        });
        skipped += 1;
        continue;
      }

      sent += 1;
    } catch {
      skipped += 1;
    }
  }

  return { scanned: subscriptions.length, sent, skipped };
}
