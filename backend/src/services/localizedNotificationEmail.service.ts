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

const MAX_SEND_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 10_000;

let retryDelayMsForTests: ((attempt: number) => number) | null = null;

/** Test seam: shorten the wait between retries. */
export function __setNotificationEmailRetryDelayForTests(fn: ((attempt: number) => number) | null): void {
  retryDelayMsForTests = fn;
}

function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryDelayMsForTests) return retryDelayMsForTests(attempt);
  const backoff = 1000 * 2 ** (attempt - 1);
  return Math.min(Math.max(retryAfterMs ?? 0, backoff), MAX_RETRY_DELAY_MS);
}

/**
 * Sends a generic transactional notification email using User.preferredLocale only.
 *
 * With an `idempotencyKey`, a retryable failure (rate limit, 5xx, network) is retried up to
 * three attempts in total. Resend deduplicates the key, so a retry after a lost response
 * cannot deliver twice. Without a key the email is sent once, as before.
 */
export type LocalizedUserNotificationEmailInput = {
  to: string;
  userId?: string | null;
  preferredLocale?: string | null;
  title: string;
  bodyText: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  preheader?: string | null;
  footerNote?: string | null;
  idempotencyKey?: string | null;
};

export async function sendLocalizedUserNotificationEmail(
  input: LocalizedUserNotificationEmailInput,
): Promise<LocalizedNotificationEmailResult> {
  const rendered = await renderLocalizedUserNotificationEmail(input);
  if (!rendered) return { accepted: false, outcome: "skipped" };
  const { to, from, subject, html, text } = rendered;

  const idempotencyKey = input.idempotencyKey?.trim() || undefined;
  const maxAttempts = idempotencyKey ? MAX_SEND_ATTEMPTS : 1;
  let sent = await sendResendEmailWithOutcome("notification", {
    from,
    to: [to],
    subject,
    html,
    text,
    idempotencyKey,
  });
  for (let attempt = 1; sent.kind === "retryable" && attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt, sent.kind === "retryable" ? sent.retryAfterMs : undefined)));
    sent = await sendResendEmailWithOutcome("notification", {
      from,
      to: [to],
      subject,
      html,
      text,
      idempotencyKey,
    });
  }
  if (sent.kind === "retryable" && idempotencyKey) {
    console.warn("[notification] email not accepted after retries", { attempts: maxAttempts, idempotencyKey });
  }
  if (sent.kind !== "sent" && process.env.NODE_ENV !== "production") {
    console.info("[notification] (dev) Would send to:", to, subject);
  }
  return sent.kind === "sent"
    ? { accepted: true, messageId: sent.messageId, outcome: "sent" }
    : { accepted: false, outcome: sent.kind };
}

/**
 * Builds the exact message a notification email sends (recipient language, personal greeting,
 * absolute app link). Shared by the direct send and the durable queue, so both produce the
 * same bytes. Returns null when there is no recipient address.
 */
export async function renderLocalizedUserNotificationEmail(
  input: LocalizedUserNotificationEmailInput,
): Promise<{ to: string; from: string; subject: string; html: string; text: string } | null> {
  const to = input.to.trim().toLowerCase();
  if (!to) return null;

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
      preheader: input.preheader,
      footerNote: input.footerNote,
    });
  try {
    ({ subject, html, text } = buildPayload(locale));
  } catch {
    locale = "en";
    ({ subject, html, text } = buildPayload("en"));
  }
  return { to, from, subject, html, text };
}

let warnedQueueUnavailable = false;
let kickForTests: ((id: string) => void) | null = null;

/** Test seam: observe or replace the immediate post-enqueue send. */
export function __setNotificationQueueKickForTests(fn: ((id: string) => void) | null): void {
  kickForTests = fn;
}

export type DurableNotificationEmailResult =
  | { mode: "queued"; deliveryId: string; created: boolean }
  | { mode: "direct"; result: LocalizedNotificationEmailResult }
  /** Not persisted and not sent; the repair pass re-enqueues it once the database is back. */
  | { mode: "not_queued"; reason: "durable_write_failed" | "queue_state_unknown" }
  | { mode: "skipped" };

/**
 * Durable notification email: render, persist in the delivery outbox, then try once right away.
 * Retries run from the queue worker, so an outage or restart does not lose the email.
 *
 * Operating modes when the outbox write fails (see resolveQueueModeAfterFailure):
 * - pre_migration: the table is missing and its migration was never applied → send directly.
 * - durable: the outbox has worked in this process → never bypass it; report not_queued.
 * - unknown: anything else (database down, inconsistent state) → do not send; report not_queued.
 * A not_queued email is not lost: the notification row records the email channel, and
 * repairMissingNotificationEmails() enqueues it when the database is reachable again.
 */
export async function queueLocalizedUserNotificationEmail(
  input: LocalizedUserNotificationEmailInput & {
    userId: string;
    idempotencyKey: string;
    kind: string;
    businessId?: string | null;
    notificationId?: string | null;
  },
): Promise<DurableNotificationEmailResult> {
  const rendered = await renderLocalizedUserNotificationEmail(input);
  if (!rendered) return { mode: "skipped" };
  const { enqueueNotificationEmail, processNotificationEmailDelivery, isQueueTableMissingError, markQueueDurable, resolveQueueModeAfterFailure } =
    await import("./notifications/notificationEmailQueue.service.js");
  let queued: { id: string; created: boolean };
  try {
    queued = await enqueueNotificationEmail({
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      businessId: input.businessId ?? null,
      notificationId: input.notificationId ?? null,
      kind: input.kind,
      to: rendered.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  } catch (err) {
    const mode = await resolveQueueModeAfterFailure(err);
    if (mode === "pre_migration") {
      if (!warnedQueueUnavailable) {
        warnedQueueUnavailable = true;
        console.warn("[notification] email outbox not migrated yet; sending directly (pre-migration mode)", {
          kind: input.kind,
        });
      }
      return { mode: "direct", result: await sendLocalizedUserNotificationEmail(input) };
    }
    console.error("[notification] email not queued; it will be repaired when the database is reachable", {
      kind: input.kind,
      mode,
      reason: isQueueTableMissingError(err) ? "table_missing" : err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    return { mode: "not_queued", reason: mode === "durable" ? "durable_write_failed" : "queue_state_unknown" };
  }
  markQueueDurable();
  if (queued.created) {
    if (kickForTests) kickForTests(queued.id);
    else {
      void processNotificationEmailDelivery(queued.id).catch((err) => {
        console.warn("[notification] immediate send failed; the queue worker will retry", {
          deliveryId: queued.id,
          reason: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        });
      });
    }
  }
  return { mode: "queued", deliveryId: queued.id, created: queued.created };
}
