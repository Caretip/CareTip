/**
 * Production reconciliation tick — lookup/reconcile only (no transfers.create).
 *
 *   npm run test:employee-transfer-reconciliation-job
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import {
  DURABLE_RELEASE_BLOCK_PREFIX,
  formatDurableReleaseBlock,
  mergeLegacyPostReclaimToDurableMarker,
  releaseCreateBlockedByStoredMarker,
} from "../src/lib/employeeTipReleaseClaim.js";
import { prisma } from "../src/prisma.js";
import { applyRefundToEmployeePayable } from "../src/services/employeeTipPayable.service.js";
import {
  __setEmployeeTipReleaseTransferListFnForTests,
  __setEmployeeTipTransferCreateFnForTests,
  __setEmployeeTipTransferReversalFnForTests,
} from "../src/services/employeeTipRelease.service.js";
import { tickEmployeeTipReleaseReconciliation } from "../src/services/employeeTipReleaseReconciliation.service.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function seedHeldPayable(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `recon-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Recon ${suffix}`,
      slug: `recon-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_recon_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: `Emp ${suffix}`,
      jobTitle: "Server",
      businessId: business.id,
      activationStatus: "active",
    },
  });
  const empAcct = `acct_recon_emp_${suffix}`;
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId: empAcct,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  const tip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_recon_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const payable = await prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id,
      employeeId: employee.id,
      businessId: business.id,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status: EmployeeTipPayableStatus.held_platform,
      grossCents: 1000,
      platformFeeCents: 100,
      payableCents: 900,
      stripePaymentIntentId: `pi_recon_${suffix}`,
      stripeChargeId: `ch_recon_${suffix}`,
    },
  });
  return { manager, business, employee, empAcct, payable };
}

async function cleanup(ctx: {
  employeeId: string;
  businessId: string;
  managerId: string;
}) {
  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.transaction.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.employee.delete({ where: { id: ctx.employeeId } });
  await prisma.business.delete({ where: { id: ctx.businessId } });
  await prisma.user.delete({ where: { id: ctx.managerId } });
}

async function main() {
  const suffix = `recon_${Date.now()}`;

  // Orphan linked via production tick (no create)
  {
    const { manager, business, employee, empAcct, payable } = await seedHeldPayable(`${suffix}_orphan`);
    const transferId = `tr_recon_job_${suffix}`;
    const durable = formatDurableReleaseBlock("orphan_suspected", transferId);
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { status: EmployeeTipPayableStatus.transferring, lastTransferError: durable },
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: transferId,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          metadata: {
            caretip_payable_id: payable.id,
            caretip_employee_id: employee.id,
            caretip_business_id: payable.businessId,
            caretip_transaction_id: payable.transactionId,
          },
        },
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    __setEmployeeTipTransferCreateFnForTests(async () => {
      throw new Error("reconciliation_tick_must_not_create");
    });
    await tickEmployeeTipReleaseReconciliation();
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(row?.status, EmployeeTipPayableStatus.transferred);
    assert.equal(row?.stripeTransferId, transferId);
    pass("job-orphan-link", "Tick reconciled orphan via list without create");
    __setEmployeeTipTransferCreateFnForTests(null);
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // Unresolved stays blocked
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_blocked`);
    const durable = formatDurableReleaseBlock("post_reclaim_empty_lookup", "job");
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: { status: EmployeeTipPayableStatus.transferring, lastTransferError: durable },
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [],
      has_more: false,
      url: "/v1/transfers",
    }));
    __setEmployeeTipTransferCreateFnForTests(async () => {
      throw new Error("reconciliation_tick_must_not_create");
    });
    await tickEmployeeTipReleaseReconciliation();
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.ok(releaseCreateBlockedByStoredMarker(row?.lastTransferError));
    pass("job-still-blocked", "Empty lookup leaves durable block; no create");
    __setEmployeeTipTransferCreateFnForTests(null);
    __setEmployeeTipReleaseTransferListFnForTests(null);
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  // One failing payable does not halt batch
  {
    const a = await seedHeldPayable(`${suffix}_batch_a`);
    const b = await seedHeldPayable(`${suffix}_batch_b`);
    const transferB = `tr_recon_batch_b_${suffix}`;
    await prisma.employeeTipPayable.update({
      where: { id: a.payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: formatDurableReleaseBlock("orphan_suspected", "tr_missing"),
      },
    });
    await prisma.employeeTipPayable.update({
      where: { id: b.payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: formatDurableReleaseBlock("orphan_suspected", transferB),
      },
    });
    __setEmployeeTipReleaseTransferListFnForTests(async (params) => {
      if (params.destination === a.empAcct) {
        throw new Error("stripe_list_flaky");
      }
      return {
        object: "list",
        data: [
          {
            id: transferB,
            object: "transfer",
            amount: 900,
            currency: "eur",
            destination: b.empAcct,
            metadata: {
              caretip_payable_id: b.payable.id,
              caretip_employee_id: b.employee.id,
              caretip_business_id: b.payable.businessId,
              caretip_transaction_id: b.payable.transactionId,
            },
          },
        ],
        has_more: false,
        url: "/v1/transfers",
      };
    });
    await tickEmployeeTipReleaseReconciliation();
    const rowA = await prisma.employeeTipPayable.findUnique({ where: { id: a.payable.id } });
    assert.equal(rowA?.stripeTransferId, null);
    const rowB = await prisma.employeeTipPayable.findUnique({ where: { id: b.payable.id } });
    assert.equal(rowB?.stripeTransferId, transferB);
    pass("job-batch-isolation", "Flaky payable did not block sibling reconcile");
    await cleanup({
      employeeId: a.employee.id,
      businessId: a.business.id,
      managerId: a.manager.id,
    });
    await cleanup({
      employeeId: b.employee.id,
      businessId: b.business.id,
      managerId: b.manager.id,
    });
  }

  // Legacy upgrade preserves claim tail (unit)
  {
    const opsClaim = "abc123456789abcd";
    const legacy = `ops_uncertain:${opsClaim}:post_reclaim_empty_lookup:tail`;
    const upgraded = mergeLegacyPostReclaimToDurableMarker(legacy);
    assert.ok(upgraded?.startsWith(DURABLE_RELEASE_BLOCK_PREFIX));
    assert.ok(upgraded?.includes(opsClaim), "legacy ops token preserved in compound marker");
    assert.ok(releaseCreateBlockedByStoredMarker(upgraded));
    pass("legacy-merge-ops", "Legacy upgrade keeps durable + ops_uncertain tail");
  }

  // Refund reversal failure preserves durable (mock reversal)
  {
    const { manager, business, employee, payable } = await seedHeldPayable(`${suffix}_rev`);
    const durable = formatDurableReleaseBlock("post_reclaim_empty_lookup", "rev");
    await prisma.employeeTipPayable.update({
      where: { id: payable.id },
      data: {
        status: EmployeeTipPayableStatus.transferred,
        stripeTransferId: `tr_rev_${suffix}`,
        transferredCents: 900,
        lastTransferError: durable,
      },
    });
    __setEmployeeTipTransferReversalFnForTests(async () => {
      throw new Error("reversal_failed");
    });
    await applyRefundToEmployeePayable({
      transactionId: payable.transactionId,
      refundedCents: 100,
    });
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.ok(releaseCreateBlockedByStoredMarker(row?.lastTransferError));
    __setEmployeeTipTransferReversalFnForTests(null);
    pass("refund-reversal-durable", "Reversal failure did not clear durable marker");
    await cleanup({
      employeeId: employee.id,
      businessId: business.id,
      managerId: manager.id,
    });
  }

  console.log("\nemployee-transfer-reconciliation-job-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
