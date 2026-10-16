/**
 * Production reconciliation for uncertain employee platform-hold transfers.
 *
 * Lookup + reconcile only — never calls transfers.create for uncertain payables.
 * Trigger: POST /api/internal/jobs/employee-tip-release-reconciliation-tick (Render cron).
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
} from "@prisma/client";
import {
  EMPLOYEE_TIP_RELEASE_RECONCILE_BATCH_SIZE,
  employeeTipReleaseReconcileStaleThresholdMs,
} from "../config/employeeTipReleaseRecovery.config.js";
import { DURABLE_RELEASE_BLOCK_PREFIX } from "../lib/employeeTipReleaseClaim.js";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { isEmployeeRecipientReady } from "./employeeTipRouting.service.js";
import { reconcileEmployeeTipReleaseTransfer } from "./employeeTipRelease.service.js";
import { isStripeConfigured } from "./stripe.service.js";

export type EmployeeTipReleaseReconciliationTickResult = {
  skipped: boolean;
  reason?: string;
  scanned: number;
  attempted: number;
  reconciled: number;
  stillUncertain: number;
  notEligible: number;
  errors: number;
  stillBlocked: number;
};

const RECONCILE_ELIGIBLE_STATUSES: EmployeeTipPayableStatus[] = [
  EmployeeTipPayableStatus.transferring,
  EmployeeTipPayableStatus.held_platform,
  EmployeeTipPayableStatus.transfer_failed,
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Bounded backoff between payables when a transient DB/lookup failure occurs.
 */
function reconcileInterPayableDelayMs(attempt: number): number {
  const base = 50;
  return Math.min(base * 2 ** Math.min(attempt, 4), 800);
}

export async function tickEmployeeTipReleaseReconciliation(): Promise<EmployeeTipReleaseReconciliationTickResult> {
  if (!isStripeConfigured()) {
    return {
      skipped: true,
      reason: "stripe_not_configured",
      scanned: 0,
      attempted: 0,
      reconciled: 0,
      stillUncertain: 0,
      notEligible: 0,
      errors: 0,
      stillBlocked: 0,
    };
  }

  return runSerializedByKey("employee-tip-release-reconciliation-tick", async () => {
    const staleBefore = new Date(Date.now() - employeeTipReleaseReconcileStaleThresholdMs());
    const batch = EMPLOYEE_TIP_RELEASE_RECONCILE_BATCH_SIZE;

    const candidates = await prisma.employeeTipPayable.findMany({
      where: {
        stripeTransferId: null,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        status: { in: RECONCILE_ELIGIBLE_STATUSES },
        OR: [
          { lastTransferError: { startsWith: DURABLE_RELEASE_BLOCK_PREFIX } },
          { lastTransferError: { contains: "post_reclaim_empty_lookup" } },
          { lastTransferError: { startsWith: "ops_uncertain:" } },
          {
            status: EmployeeTipPayableStatus.transferring,
            updatedAt: { lt: staleBefore },
          },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: batch,
      select: {
        id: true,
        employeeId: true,
        lastTransferError: true,
      },
    });

    const summary: EmployeeTipReleaseReconciliationTickResult = {
      skipped: false,
      scanned: candidates.length,
      attempted: 0,
      reconciled: 0,
      stillUncertain: 0,
      notEligible: 0,
      errors: 0,
      stillBlocked: 0,
    };

    let transientFailures = 0;

    for (const row of candidates) {
      summary.attempted += 1;
      try {
        const employeeId = row.employeeId;
        if (!employeeId) {
          summary.notEligible += 1;
          continue;
        }
        const account = await prisma.employeeStripeAccount.findUnique({
          where: { employeeId },
          select: {
            stripeAccountId: true,
            stripeConnectStatus: true,
            stripePayoutsEnabled: true,
          },
        });
        if (!account || !isEmployeeRecipientReady(account)) {
          summary.notEligible += 1;
          continue;
        }
        const employee = await prisma.employee.findUnique({
          where: { id: employeeId },
          select: { isDeleted: true, isActive: true, activationStatus: true },
        });
        if (
          !employee ||
          employee.isDeleted ||
          !employee.isActive ||
          employee.activationStatus !== "active"
        ) {
          summary.notEligible += 1;
          continue;
        }

        const dest = account.stripeAccountId?.trim() ?? "";
        if (!dest) {
          summary.notEligible += 1;
          continue;
        }
        const outcome = await reconcileEmployeeTipReleaseTransfer({
          payableId: row.id,
          employeeId,
          destinationAccountId: dest,
        });

        if (outcome === "reconciled") {
          summary.reconciled += 1;
        } else if (outcome === "still_uncertain") {
          summary.stillUncertain += 1;
          if (row.lastTransferError?.startsWith(DURABLE_RELEASE_BLOCK_PREFIX)) {
            summary.stillBlocked += 1;
          }
        } else {
          summary.notEligible += 1;
        }
      } catch (err) {
        summary.errors += 1;
        transientFailures += 1;
        logServerError("employeeTipReleaseReconciliation.payable", err, {
          payableId: row.id,
          employeeId: row.employeeId,
        });
        await sleep(reconcileInterPayableDelayMs(transientFailures));
      }
    }

    if (summary.stillUncertain > 0 || summary.errors > 0) {
      console.info("[employeeTipReleaseReconciliation.tick]", {
        scanned: summary.scanned,
        attempted: summary.attempted,
        reconciled: summary.reconciled,
        stillUncertain: summary.stillUncertain,
        stillBlocked: summary.stillBlocked,
        notEligible: summary.notEligible,
        errors: summary.errors,
      });
    }

    return summary;
  });
}
