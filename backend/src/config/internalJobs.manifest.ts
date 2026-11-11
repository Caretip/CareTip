/**
 * Every internal job and how it is meant to run. `scripts/security-hardening-unit-runtime.ts` fails if
 * a route and this list disagree, or if render.yaml differs from BLUEPRINT_JOBS.
 *
 * A job missing from render.yaml may still run as a service created in the Render Dashboard, so its
 * absence says nothing about whether it is scheduled. `schedule` is a suggestion for those jobs.
 *
 * `gate` lists the env flags that must all be "true" before a job can change data. Without them a
 * destructive job only reports what it would do, which is why scheduling one is safe.
 * Runbook: docs/ops/scheduled-jobs.md
 */
export type InternalJobSpec = {
  path: string;
  schedule: string;
  purpose: string;
  destructive: boolean;
  gate?: string[];
};

export const INTERNAL_JOBS: InternalJobSpec[] = [
  { path: "trial-reminders", schedule: "0 7 * * *", purpose: "Trial ending reminders", destructive: false },
  { path: "subscription-billing-reconciliation", schedule: "30 5 * * *", purpose: "Stripe and subscription mirror drift", destructive: false },
  { path: "subscription-billing-notification-retry", schedule: "*/15 * * * *", purpose: "Retry billing emails", destructive: false },
  { path: "scheduled-bank-payout-tick", schedule: "see render.yaml", purpose: "Scheduled bank payouts", destructive: false },
  { path: "scheduled-payout-incident-sync", schedule: "*/30 * * * *", purpose: "Keep payout incident records current", destructive: false },
  { path: "connect-payout-reconciliation-tick", schedule: "20 * * * *", purpose: "Find payout drift against Stripe", destructive: false },
  { path: "business-distribution-integrity-scan", schedule: "45 4 * * *", purpose: "Find tip distribution ledger drift", destructive: false },
  { path: "employee-tip-release-reconciliation-tick", schedule: "*/10 * * * *", purpose: "Resolve uncertain tip transfers", destructive: false },
  { path: "employee-stripe-inactivity-tick", schedule: "15 6 * * *", purpose: "Review inactive employee accounts", destructive: false },
  { path: "dsar-export-tick", schedule: "*/5 * * * *", purpose: "Build data export requests", destructive: false },
  { path: "purge-mobile-web-handoff", schedule: "5 * * * *", purpose: "Remove expired handoff tokens", destructive: false },
  { path: "category-retention-sweep", schedule: "see render.yaml", purpose: "Queue retention work", destructive: true, gate: ["DATA_LIFECYCLE_V1"] },
  { path: "category-retention-tick", schedule: "10,25,40,55 * * * *", purpose: "Apply retention by category", destructive: true, gate: ["DATA_LIFECYCLE_V1", "DATA_LIFECYCLE_*_EXECUTE"] },
  { path: "anonymization-tick", schedule: "35 * * * *", purpose: "Account erasure after the grace period", destructive: true, gate: ["DATA_LIFECYCLE_V1", "DATA_LIFECYCLE_ANONYMIZATION_EXECUTE"] },
  { path: "kyc-secure-destroy-sweep", schedule: "50 3 * * *", purpose: "Queue KYC documents past retention", destructive: true, gate: ["DATA_LIFECYCLE_V1"] },
  { path: "kyc-secure-destroy-tick", schedule: "15 4 * * *", purpose: "Destroy queued KYC documents", destructive: true, gate: ["DATA_LIFECYCLE_V1", "DATA_LIFECYCLE_KYC_DESTROY_EXECUTE"] },
  { path: "business-tombstone-sweep", schedule: "55 3 * * *", purpose: "Queue closed businesses", destructive: true, gate: ["DATA_LIFECYCLE_V1"] },
  { path: "business-tombstone-tick", schedule: "25 4 * * *", purpose: "Finalise closed businesses", destructive: true, gate: ["DATA_LIFECYCLE_V1", "DATA_LIFECYCLE_TOMBSTONE_EXECUTE"] },
];

/** The jobs render.yaml declares. Adding one creates a Render service, so it needs owner approval. */
export const BLUEPRINT_JOBS: readonly string[] = [
  "trial-reminders",
  "subscription-billing-reconciliation",
  "subscription-billing-notification-retry",
  "category-retention-sweep",
  "category-retention-tick",
  "employee-stripe-inactivity-tick",
  "employee-tip-release-reconciliation-tick",
  "scheduled-bank-payout-tick",
];

/** Project rule stated in render.yaml: these destructive jobs must never be declared there. */
export const BLUEPRINT_FORBIDDEN_JOBS: readonly string[] = [
  "anonymization-tick",
  "kyc-secure-destroy-sweep",
  "kyc-secure-destroy-tick",
  "business-tombstone-sweep",
  "business-tombstone-tick",
];
