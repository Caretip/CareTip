/**
 * In-process notification worker: drains the email outbox and repairs missed payout
 * notifications on a short interval. Safe on any number of instances (rows are claimed with
 * SKIP LOCKED; payout notifications are deduplicated by key).
 *
 * On by default only in production. Local development often points at a shared database, where a
 * background job must not act on real records, so elsewhere it needs NOTIFICATION_WORKER_ENABLED=true.
 * The cron route /api/internal/jobs/notification-delivery-tick runs the same work as a backup.
 */
import { isQueueTableMissingError, runNotificationEmailDeliveryTick } from "./notificationEmailQueue.service.js";

const DEFAULT_INTERVAL_MS = 60_000;
const TABLE_MISSING_PAUSE_MS = 10 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let pausedUntil = 0;
let running = false;

export function notificationWorkerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.NOTIFICATION_WORKER_ENABLED?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return env.NODE_ENV === "production";
}

/** One pass: email outbox, then the payout notification repair sweep. Never throws. */
export async function runNotificationWorkerPass(): Promise<void> {
  if (running || Date.now() < pausedUntil) return;
  running = true;
  try {
    await runNotificationEmailDeliveryTick({ limit: 25 });
    const { repairMissingNotificationEmails } = await import("./notificationEmailRepair.service.js");
    await repairMissingNotificationEmails({ limit: 50 });
    const { sweepRecentPayoutNotifications } = await import("./payoutNotifications.service.js");
    await sweepRecentPayoutNotifications({ limit: 50 });
  } catch (err) {
    if (isQueueTableMissingError(err)) {
      pausedUntil = Date.now() + TABLE_MISSING_PAUSE_MS;
      console.error("[notificationWorker] outbox table missing; run database migrations. Pausing 10 minutes.");
    } else {
      console.error("[notificationWorker] pass failed", {
        reason: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      });
    }
  } finally {
    running = false;
  }
}

export function startNotificationWorker(env: NodeJS.ProcessEnv = process.env): boolean {
  if (timer || !notificationWorkerEnabled(env)) return false;
  const raw = Number(env.NOTIFICATION_WORKER_INTERVAL_MS);
  const interval = Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_INTERVAL_MS;
  timer = setInterval(() => void runNotificationWorkerPass(), interval);
  timer.unref();
  console.info("[notificationWorker] started", { intervalMs: interval });
  return true;
}

export function stopNotificationWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
