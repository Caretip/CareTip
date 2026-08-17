import { Router } from "express";
import { runTrialReminderEmails } from "../services/trialReminderEmail.service.js";
import { purgeStaleMobileWebHandoffTokens } from "../services/mobileWebHandoff.service.js";

const router = Router();

function authorizeCronRequest(req: import("express").Request): boolean {
  const secret =
    process.env.CRON_SECRET?.trim() ||
    process.env.HEALTH_CHECK_SECRET?.trim();
  if (!secret) return false;
  return req.get("x-cron-secret") === secret;
}

/** POST /api/internal/jobs/trial-reminders — idempotent trial ending reminders (7 / 3 / 1 days). */
router.post("/trial-reminders", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const result = await runTrialReminderEmails();
  return res.json({ ok: true, ...result });
});

/** POST /api/internal/jobs/purge-mobile-web-handoff — delete expired / consumed handoff rows. */
router.post("/purge-mobile-web-handoff", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const result = await purgeStaleMobileWebHandoffTokens();
  return res.json({ ok: true, ...result });
});

/** POST /api/internal/jobs/dsar-export-tick — process pending DSAR jobs + expire artifacts (Slice E). */
router.post("/dsar-export-tick", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { tickDsarExportJobs } = await import("../services/dsarExport.service.js");
  const result = await tickDsarExportJobs();
  return res.json({ ok: true, ...result });
});

/**
 * POST /api/internal/jobs/anonymization-tick — Slice F-A anonymize_user / anonymize_employee.
 * Fail-closed: no-ops unless DATA_LIFECYCLE_V1 and DATA_LIFECYCLE_ANONYMIZATION_EXECUTE are enabled.
 * Does not run KYC/payment/T_* destruction.
 */
router.post("/anonymization-tick", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { tickAnonymizationJobs } = await import("../services/anonymization.service.js");
  const result = await tickAnonymizationJobs();
  return res.json({ ok: true, ...result });
});

/**
 * POST /api/internal/jobs/kyc-secure-destroy-tick — Slice F-B kyc_secure_destroy.
 * Fail-closed: no-ops unless DATA_LIFECYCLE_V1 and DATA_LIFECYCLE_KYC_DESTROY_EXECUTE are enabled.
 * RETENTION_T_KYC_DAYS must remain UNSET (approved 10-year calendar-year policy).
 * Does not invent T_KYC. Does not run payment retention. Does not enqueue — see kyc-secure-destroy-sweep.
 */
router.post("/kyc-secure-destroy-tick", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { tickKycSecureDestroyJobs } = await import("../services/kycSecureDestroy.service.js");
  const result = await tickKycSecureDestroyJobs();
  return res.json({ ok: true, ...result });
});

/**
 * POST /api/internal/jobs/category-retention-tick — Slice F-C analytics/audit/support/notify/guest/billing/staff_pii.
 * Fail-closed per category: UNSET T_* and/or execute flag OFF → no destructive work for that category.
 * Polls queued DataLifecycleJob rows only. Platform discovery is category-retention-sweep.
 */
router.post("/category-retention-tick", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { tickCategoryRetentionJobs } = await import("../services/categoryRetention.service.js");
  const result = await tickCategoryRetentionJobs();
  return res.json({ ok: true, ...result });
});

/**
 * POST /api/internal/jobs/category-retention-sweep — discover eligible F-C work and enqueue jobs.
 * Does not run category workers. DRY_RUN (V1+DATA_LIFECYCLE_DRY_RUN) never creates jobs.
 * Enqueue mode (V1, DRY_RUN off) writes DataLifecycleJob rows only; mutation still requires tick+EXECUTE.
 */
router.post("/category-retention-sweep", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { sweepCategoryRetention } = await import("../services/categoryRetentionSweep.service.js");
  const result = await sweepCategoryRetention();
  return res.json({
    ok: true,
    mode: result.mode,
    gated: result.gated,
    dryRun: result.dryRun,
    kinds: result.kinds,
  });
});

/**
 * POST /api/internal/jobs/kyc-secure-destroy-sweep — enqueue eligible kyc_secure_destroy jobs.
 * Never calls secureDestroyBusinessKyc. DRY_RUN never creates jobs. Tick+EXECUTE still required to destroy.
 */
router.post("/kyc-secure-destroy-sweep", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { sweepKycSecureDestroy } = await import("../services/kycDestroySweep.service.js");
  const result = await sweepKycSecureDestroy();
  return res.json({
    ok: true,
    mode: result.mode,
    gated: result.gated,
    dryRun: result.dryRun,
    wouldEnqueue: result.wouldEnqueue,
    enqueued: result.enqueued,
    exists: result.exists,
    skipped: result.skipped,
    businessIds: result.rows.map((r) => r.businessId),
  });
});

/**
 * POST /api/internal/jobs/business-tombstone-sweep — enqueue eligible business_tombstone jobs.
 * Never strips assets. DRY_RUN never creates jobs.
 */
router.post("/business-tombstone-sweep", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { sweepBusinessTombstone } = await import("../services/businessTombstoneSweep.service.js");
  const result = await sweepBusinessTombstone();
  return res.json({
    ok: true,
    mode: result.mode,
    gated: result.gated,
    dryRun: result.dryRun,
    wouldEnqueue: result.wouldEnqueue,
    enqueued: result.enqueued,
    exists: result.exists,
    skipped: result.skipped,
    businessIds: result.rows.map((r) => r.businessId),
  });
});

/**
 * POST /api/internal/jobs/business-tombstone-tick — process queued business_tombstone jobs.
 * No-op unless V1 + DATA_LIFECYCLE_TOMBSTONE_EXECUTE. DRY_RUN does not claim jobs.
 */
router.post("/business-tombstone-tick", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { tickBusinessTombstoneJobs } = await import("../services/businessTombstoneSweep.service.js");
  const result = await tickBusinessTombstoneJobs();
  return res.json({ ok: true, ...result });
});

/**
 * POST /api/internal/jobs/connect-payout-reconciliation-tick
 * Resume incomplete Stripe Connect payout balance-transaction sync.
 * Observation only — does not create or cancel payouts.
 */
router.post("/connect-payout-reconciliation-tick", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { tickConnectPayoutReconciliation } = await import(
    "../services/stripeConnectPayoutReconciliation.service.js"
  );
  const result = await tickConnectPayoutReconciliation();
  return res.json({ ok: true, ...result });
});

export default router;
