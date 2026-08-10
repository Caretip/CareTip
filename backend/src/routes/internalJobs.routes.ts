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
 * Fail-closed: no-ops unless DATA_LIFECYCLE_V1 and DATA_LIFECYCLE_KYC_DESTROY_EXECUTE are enabled
 * AND RETENTION_T_KYC_DAYS is explicitly set. Does not invent T_KYC. Does not run payment retention.
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
 * Does not invent retention days. Does not run KYC/payment ledger destruction or Business tombstoning.
 */
router.post("/category-retention-tick", async (req, res) => {
  if (!authorizeCronRequest(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const { tickCategoryRetentionJobs } = await import("../services/categoryRetention.service.js");
  const result = await tickCategoryRetentionJobs();
  return res.json({ ok: true, ...result });
});

export default router;
