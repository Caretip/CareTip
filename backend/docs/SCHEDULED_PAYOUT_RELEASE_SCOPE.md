# Scheduled payout release — file scope inventory

Generated for release planning. **Do not** treat this as a commit list; verify `git status` before staging.

## Commit group A — Phase A / A.2 (recovery, claims, scheduled runners)

**Schema & migrations (apply in order on target env):**

- `backend/prisma/schema.prisma` (modified)
- `backend/prisma/migrations/20261010180000_scheduled_payout_recovery_fields/` (untracked)
- `backend/prisma/migrations/20261010210000_scheduled_payout_claim_token/` (untracked)

**Backend core:**

- `backend/src/services/scheduledBankPayoutRecovery.service.ts` (untracked)
- `backend/src/services/scheduledBankPayoutProcessingClaim.service.ts` (untracked)
- `backend/src/services/scheduledBankPayoutLedger.util.ts` (untracked)
- `backend/src/config/scheduledPayoutStripeMetadata.ts` (untracked)
- `backend/src/services/employeeScheduledBankPayout.service.ts` (modified)
- `backend/src/services/businessScheduledBankPayout.service.ts` (modified)

**Runtime tests (isolated / optional DB):**

- `backend/scripts/scheduled-bank-payout-recovery-runtime.ts` (untracked)
- `backend/scripts/scheduled-bank-payout-phase-a-closure-runtime.ts` (untracked)
- `backend/scripts/employee-scheduled-bank-payout-runtime.ts` (untracked)
- `backend/scripts/business-scheduled-bank-payout-runtime.ts` (modified)
- `backend/package.json` (modified — npm scripts)

**Forensic / readonly scripts (exclude from production deploy artifact):**

- `backend/scripts/_readonly-*.mjs` (untracked)

## Commit group B — Phase B (operations center)

**Backend API:**

- `backend/src/services/platformScheduledPayoutOperations.service.ts` (untracked; restored after disk event — **no git baseline**)
- `backend/src/controllers/platformScheduledPayoutOps.controller.ts` (untracked)
- `backend/src/lib/platformAdminAccess.ts` (untracked)
- `backend/src/routes/platform.routes.ts` (modified)
- `backend/src/services/auth.service.ts` (modified — `isPlatformAdmin` DTO)
- `backend/src/config/securityRateLimit.config.ts` (modified)
- `backend/src/middleware/securityRateLimit.middleware.ts` (modified)

**Frontend:**

- `src/app/pages/platform/revenue/PlatformScheduledPayoutOperationsPage.tsx` (untracked)
- `src/app/routes.tsx` (modified)
- `src/app/components/platform/platformAdminNav.ts` (modified)
- `src/app/components/PlatformAdminRoute.tsx` (modified)
- `src/app/lib/api.ts` (modified)
- `src/app/lib/authSession.ts` (modified)
- `src/app/hooks/useAuth.ts` (modified)
- `src/i18n/locales/en.json`, `de.json` (modified)
- `scripts/scheduled-payout-ops-ui-runtime.ts` (untracked)
- `package.json` (modified — if root scripts added)

## Commit group C — P0/P1 hardening & audit safety

- `backend/src/services/audit.service.ts` (modified — `writeAuditLogStrict`, test-hook gating)
- `backend/src/lib/scheduledPayoutRuntimeTestHooks.ts` (new)
- `backend/scripts/platform-scheduled-payout-ops-runtime.ts` (untracked)
- `backend/docs/SCHEDULED_PAYOUT_OPERATIONS_RUNBOOK.md` (new)
- `backend/docs/SCHEDULED_PAYOUT_TRY_PERSIST_INTEGRATION_TEST_PLAN.md` (new)
- This file

(Hardening logic lives primarily in group B service + recovery service pagination.)

## Unrelated — do **not** include in payout release commit

**Deleted images (working tree):**

- `images/Beauty Salon.*`, `analytics01.*`, `bar and lounge.*`, `barchart.*`, `bizzy002.*`, `cafe-employee.*`, `caretip-image.*`, `caretip-mission001.png`, `caring001.webp`, `caring002.png`

**OAuth / Facebook / landing / CSS:**

- `src/app/components/auth/OAuthProviderRow.tsx`
- `src/app/components/auth/FacebookOAuthRecoveryNotice.tsx` (untracked)
- `src/app/lib/facebookOAuthRedirectRecovery*.ts` (untracked)
- `src/app/lib/facebookOAuthRedirectStart.runtime.ts`
- `src/app/components/landing/LandingCustomerJourneySection.tsx`
- `src/styles/caretip-auth.css`, `caretip-landing-customerjourney.css`, `caretip-language-select.css`, `caretip-marketing-pages-optical-balance.css`

**Other:**

- `public/sitemap.xml`

## Baseline verification gaps

| File | Issue |
|------|--------|
| Entire Phase B + recovery services | **Untracked** — cannot diff against `HEAD` |
| `platformScheduledPayoutOperations.service.ts` | **Restored from agent transcript** after disk-full truncation; re-hardened in repo — integrity verified by `tsc` and runtime scripts, not by git history |

## Dependencies (must ship together)

1. Migrations **before** backend that expects new columns/enums.
2. Backend **with** frontend (`isPlatformAdmin`, ops API routes, ops page).
3. `securityRateLimit` config **with** platform routes that reference `platformScheduledPayoutOpsMutationRateLimit`.
