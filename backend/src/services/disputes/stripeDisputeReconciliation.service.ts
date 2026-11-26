/**
 * Bounded dispute reconciliation (internal job "dispute-reconciliation-tick"):
 *  1. lists recent platform disputes from Stripe and syncs any that are missing locally or differ
 *     (missed or failed webhooks);
 *  2. re-reads open disputes whose last Stripe sync is old;
 *  3. sends one "evidence due" reminder per deadline;
 *  4. resolves pending/unknown recovery attempts from the transfer reversals.
 * It never submits evidence and never starts a recovery. The only money it can move is a scheduled
 * retry of a recovery a platform admin already approved (tickApprovedRecoveryRetries), within that
 * approval's transfer, amount and the account's available balance.
 */
import type Stripe from "stripe";
import { prisma } from "../../prisma.js";
import { getStripeClient } from "../stripe.service.js";
import { logServerError } from "../../utils/httpErrors.js";
import { summarizeDisputeFunds, syncStripeDisputeFromStripe } from "./stripeDisputeProjection.service.js";
import { notifyStripeDisputeEvent } from "./stripeDisputeNotify.service.js";
import { reconcileOpenRecoveryAttempts, tickApprovedRecoveryRetries } from "./stripeDisputeRecovery.service.js";

const OPEN_STATUSES = ["needs_response", "under_review", "warning_needs_response", "warning_under_review"];

export type DisputeReconciliationResult = {
  listed: number;
  missingSynced: number;
  driftSynced: number;
  staleSynced: number;
  remindersSent: number;
  recoveryChecked: number;
  approvedRetriesChecked: number;
  approvedRetriesAttempted: number;
  errors: number;
};

export async function tickStripeDisputeReconciliation(opts?: {
  lookbackDays?: number;
  maxPages?: number;
  staleLimit?: number;
  now?: Date;
}): Promise<DisputeReconciliationResult> {
  const now = opts?.now ?? new Date();
  const result: DisputeReconciliationResult = {
    listed: 0,
    missingSynced: 0,
    driftSynced: 0,
    staleSynced: 0,
    remindersSent: 0,
    recoveryChecked: 0,
    approvedRetriesChecked: 0,
    approvedRetriesAttempted: 0,
    errors: 0,
  };
  const stripe = getStripeClient();
  const since = Math.floor(now.getTime() / 1000) - (opts?.lookbackDays ?? 120) * 86_400;
  let startingAfter: string | undefined;
  for (let page = 0; page < (opts?.maxPages ?? 3); page++) {
    let list: Stripe.ApiList<Stripe.Dispute>;
    try {
      list = await stripe.disputes.list({ limit: 100, created: { gte: since }, ...(startingAfter ? { starting_after: startingAfter } : {}) });
    } catch (err) {
      result.errors++;
      logServerError("stripeDispute.reconcile.list", err);
      break;
    }
    result.listed += list.data.length;
    const local = await prisma.stripeDispute.findMany({
      where: { stripeDisputeId: { in: list.data.map((d) => d.id) } },
      select: { stripeDisputeId: true, stripeStatus: true, balanceTransactionCount: true, evidenceSubmissionCount: true },
    });
    const byId = new Map(local.map((l) => [l.stripeDisputeId, l]));
    for (const d of list.data) {
      const mine = byId.get(d.id);
      const drift =
        mine &&
        (mine.stripeStatus !== d.status ||
          mine.balanceTransactionCount !== summarizeDisputeFunds(d).count ||
          mine.evidenceSubmissionCount !== (d.evidence_details?.submission_count ?? 0));
      if (mine && !drift) continue;
      try {
        await syncStripeDisputeFromStripe(d.id, { source: "reconciliation" });
        if (mine) result.driftSynced++;
        else result.missingSynced++;
      } catch (err) {
        result.errors++;
        logServerError("stripeDispute.reconcile.sync", err, { stripeDisputeId: d.id });
      }
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1]!.id;
  }

  // Open disputes not read for six hours, including connected-account ones the list above cannot see.
  const stale = await prisma.stripeDispute.findMany({
    where: { stripeStatus: { in: OPEN_STATUSES }, lastStripeSyncAt: { lt: new Date(now.getTime() - 6 * 3600_000) } },
    select: { stripeDisputeId: true, stripeEventAccountId: true },
    orderBy: { lastStripeSyncAt: "asc" },
    take: opts?.staleLimit ?? 25,
  });
  for (const s of stale) {
    try {
      await syncStripeDisputeFromStripe(s.stripeDisputeId, { source: "reconciliation", stripeEventAccount: s.stripeEventAccountId });
      result.staleSynced++;
    } catch (err) {
      result.errors++;
      logServerError("stripeDispute.reconcile.stale", err, { stripeDisputeId: s.stripeDisputeId });
    }
  }

  // One reminder per deadline: response needed, nothing submitted, due within 72 hours.
  const due = await prisma.stripeDispute.findMany({
    where: {
      stripeStatus: { in: ["needs_response", "warning_needs_response"] },
      evidenceSubmissionCount: 0,
      evidenceDueBy: { gt: now, lt: new Date(now.getTime() + 72 * 3600_000) },
    },
    select: { id: true, evidenceDueBy: true },
    take: 50,
  });
  for (const d of due) {
    if (await notifyStripeDisputeEvent(d.id, "evidence_due", d.evidenceDueBy!.toISOString().slice(0, 10))) {
      result.remindersSent++;
    }
  }

  const recovery = await reconcileOpenRecoveryAttempts(20);
  result.recoveryChecked = recovery.checked;
  result.errors += recovery.errors;
  const retries = await tickApprovedRecoveryRetries({ now, limit: 10 });
  result.approvedRetriesChecked = retries.checked;
  result.approvedRetriesAttempted = retries.attempted;
  result.errors += retries.errors;
  console.info("[stripe.dispute] reconciliation", result);
  return result;
}
