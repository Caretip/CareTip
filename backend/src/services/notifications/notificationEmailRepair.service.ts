/**
 * Repair pass for notification emails that were never persisted in the outbox (the database was
 * unreachable when the notification was created, so the email was reported not_queued).
 *
 * Source of truth: the notification row itself records `email` in its channels. Every such row
 * created after the outbox went live must have a delivery row with the key
 * `notification-email:<notificationId>`; any that does not is enqueued now with that same key,
 * so this can never produce a second email for one that was queued.
 *
 * Window: only rows created after the queue migration finished (+10 minutes for a rolling deploy,
 * when old instances may still send directly), older than 2 minutes (the normal path is still
 * running) and younger than 23 hours (inside Resend's idempotency window).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { sqlUtcTimestamp } from "../../utils/sqlUtcTimestamp.js";
import { localizeNotificationPayload, type NotificationTemplate } from "../../notifications/notificationI18n.js";
import { resolveUserPreferredLocale } from "../../emails/i18nEmail.js";
import { employeeTipEmailRequest } from "./employeeTipNotificationPrefs.js";
import { queueMigrationFinishedAt } from "./notificationEmailQueue.service.js";
import { queueLocalizedUserNotificationEmail } from "../localizedNotificationEmail.service.js";

const ROLLOUT_GRACE_MS = 10 * 60_000;
const MIN_AGE_MS = 2 * 60_000;
const MAX_AGE_MS = 23 * 60 * 60_000;

let clockForTests: (() => number) | null = null;
export function __setNotificationRepairClockForTests(fn: (() => number) | null): void {
  clockForTests = fn;
}

type Row = { id: string; user_id: string; type: string; title: string; message: string; metadata: unknown };

export async function repairMissingNotificationEmails(opts?: { limit?: number }): Promise<{ checked: number; queued: number; skipped: number }> {
  const finishedAt = await queueMigrationFinishedAt();
  if (!finishedAt) return { checked: 0, queued: 0, skipped: 0 };
  const now = clockForTests ? clockForTests() : Date.now();
  const since = new Date(Math.max(finishedAt.getTime() + ROLLOUT_GRACE_MS, now - MAX_AGE_MS));
  const until = new Date(now - MIN_AGE_MS);
  if (since >= until) return { checked: 0, queued: 0, skipped: 0 };
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT n."id", n."user_id", n."type", n."title", n."message", n."metadata"
    FROM "notifications" n
    WHERE 'email' = ANY(n."channels")
      AND n."created_at" >= ${sqlUtcTimestamp(since)}
      AND n."created_at" <= ${sqlUtcTimestamp(until)}
      AND NOT EXISTS (
        SELECT 1 FROM "notification_email_deliveries" d
        WHERE d."idempotency_key" = 'notification-email:' || n."id"
      )
    ORDER BY n."created_at" ASC
    LIMIT ${limit}
  `);

  let queued = 0;
  let skipped = 0;
  for (const row of rows) {
    const ok = await repairOne(row);
    if (ok) queued += 1;
    else skipped += 1;
  }
  if (rows.length > 0) console.warn("[notificationRepair] re-enqueued missing notification emails", { checked: rows.length, queued, skipped });
  return { checked: rows.length, queued, skipped };
}

async function repairOne(row: Row): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: row.user_id },
    select: { email: true, preferredLocale: true, isActive: true },
  });
  if (!user?.email || user.isActive !== true) return false;

  const meta = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};
  const template = (meta.localeTemplate && typeof meta.localeTemplate === "object"
    ? (meta.localeTemplate as NotificationTemplate)
    : undefined);
  const templateId = template?.id ?? (typeof meta.templateId === "string" ? meta.templateId : undefined);
  const locale = resolveUserPreferredLocale(user.preferredLocale) === "de" ? "de" : "en";

  // Same content the orchestrator would have sent.
  let title: string;
  let bodyText: string;
  let extra: { preheader?: string; actionLabel?: string; footerNote?: string } = {};
  if (templateId === "tip_received_employee") {
    const req = employeeTipEmailRequest(locale);
    title = req.title;
    bodyText = req.bodyText;
    extra = { preheader: req.preheader, actionLabel: req.actionLabel, footerNote: req.footerNote };
  } else if (row.type === "delivery_anchor") {
    // Inbox was off: the row holds placeholders, so the template is the only real content.
    if (!template || !("params" in template)) return false;
    const copy = localizeNotificationPayload(user.preferredLocale, { title: "", body: "", localeTemplate: template });
    if (!copy.title || !copy.body) return false;
    title = copy.title;
    bodyText = copy.body;
  } else {
    title = row.title;
    bodyText = row.message;
  }

  const result = await queueLocalizedUserNotificationEmail({
    to: user.email,
    userId: row.user_id,
    preferredLocale: user.preferredLocale,
    title,
    bodyText,
    ...extra,
    actionUrl: typeof meta.url === "string" ? meta.url : null,
    idempotencyKey: `notification-email:${row.id}`,
    kind: templateId ?? row.type,
    businessId: typeof meta.businessId === "string" ? meta.businessId : null,
    notificationId: row.id,
  });
  // A concurrent repair may have enqueued it first: the unique key keeps one row, and only the
  // run that created it counts it.
  return result.mode === "queued" && result.created;
}
