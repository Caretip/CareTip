/**
 * Stripe transfer list recovery (mocked list/create, real PostgreSQL).
 *
 *   npm run test:employee-transfer-lookup-recovery
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Role,
  StripeConnectStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import {
  __setEmployeeTipReleaseTransferListFnForTests,
  __setEmployeeTipTransferCreateFnForTests,
  findStripeTransfersForEmployeeTipPayable,
  reconcileEmployeeTipReleaseTransfer,
  releaseHeldPlatformPayablesForEmployee,
  warnStaleTransferringEmployeeTipPayables,
} from "../src/services/employeeTipRelease.service.js";
import {
  clearMockEmployeeTipStripeTransferList,
  installMockEmptyEmployeeTipTransferList,
} from "./lib/mockEmployeeTipStripeTransferList.js";

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function seedEmployee(suffix: string) {
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `lk-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `Lk ${suffix}`,
      slug: `lk-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_lk_biz_${suffix}`,
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
  const empAcct = `acct_lk_emp_${suffix}`;
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId: empAcct,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  return { manager, business, employee, empAcct };
}

async function seedPayable(
  employeeId: string,
  businessId: string,
  suffix: string,
  status: EmployeeTipPayableStatus,
  opts?: { updatedAt?: Date },
) {
  const tip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_lk_${suffix}`,
      employeeId,
      businessId,
    },
  });
  return prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id,
      employeeId,
      businessId,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      status,
      grossCents: 1000,
      platformFeeCents: 100,
      payableCents: 900,
      stripePaymentIntentId: `pi_lk_${suffix}`,
      stripeChargeId: `ch_lk_${suffix}`,
      updatedAt: opts?.updatedAt ?? new Date(),
    },
  });
}

async function cleanup(ctx: { employeeId: string; businessId: string; managerId: string }) {
  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.transaction.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: ctx.employeeId } });
  await prisma.employee.delete({ where: { id: ctx.employeeId } });
  await prisma.business.delete({ where: { id: ctx.businessId } });
  await prisma.user.delete({ where: { id: ctx.managerId } });
}

function transferFixture(
  payableId: string,
  employeeId: string,
  businessId: string,
  transactionId: string,
  dest: string,
  id: string,
): Stripe.Transfer {
  return {
    id,
    object: "transfer",
    amount: 900,
    currency: "eur",
    destination: dest,
    metadata: {
      caretip_payable_id: payableId,
      caretip_employee_id: employeeId,
      caretip_business_id: businessId,
      caretip_transaction_id: transactionId,
    },
  } as Stripe.Transfer;
}

async function main() {
  const suffix = `lk_${Date.now()}`;

  // Existing transfer found via list → persist, no create
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_found`);
    const payable = await seedPayable(
      employee.id,
      business.id,
      `${suffix}_found`,
      EmployeeTipPayableStatus.transferring,
    );
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_should_not_run", amount: 900 };
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        transferFixture(
          payable.id,
          employee.id,
          business.id,
          payable.transactionId,
          empAcct,
          `tr_lk_found_${suffix}`,
        ),
      ],
      has_more: false,
      url: "/v1/transfers",
    }));

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(createCalls, 0);
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(row?.stripeTransferId, `tr_lk_found_${suffix}`);
    pass("found-existing", "Single list match persisted without transfers.create");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Not found + complete pagination → create allowed
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_none`);
    await seedPayable(employee.id, business.id, `${suffix}_none`, EmployeeTipPayableStatus.transferring);
    installMockEmptyEmployeeTipTransferList();
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: `tr_lk_new_${suffix}`, amount: 900 };
    });

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(createCalls, 1);
    pass("not-found-create", "Complete empty list allows one transfers.create");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Duplicate metadata matches → manual reconcile, no create
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_dup`);
    const payable = await seedPayable(
      employee.id,
      business.id,
      `${suffix}_dup`,
      EmployeeTipPayableStatus.transferring,
    );
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_dup_bad", amount: 900 };
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        transferFixture(payable.id, employee.id, business.id, payable.transactionId, empAcct, `tr_a_${suffix}`),
        transferFixture(payable.id, employee.id, business.id, payable.transactionId, empAcct, `tr_b_${suffix}`),
      ],
      has_more: false,
      url: "/v1/transfers",
    }));

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 0);
    assert.equal(result.uncertain, 1);
    assert.equal(createCalls, 0);
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.match(row?.lastTransferError ?? "", /duplicate_stripe_transfer/);
    pass("duplicate-matches", "Multiple Stripe matches flagged manual_reconcile");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Lookup failure → blocked, no create
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_fail`);
    await seedPayable(employee.id, business.id, `${suffix}_fail`, EmployeeTipPayableStatus.transferring);
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_fail", amount: 900 };
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => {
      throw new Error("stripe_list_down");
    });

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.uncertain, 1);
    assert.equal(createCalls, 0);
    pass("lookup-failure", "Stripe list error blocks create");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Incomplete pagination (has_more) → blocked
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_page`);
    const payable = await seedPayable(
      employee.id,
      business.id,
      `${suffix}_page`,
      EmployeeTipPayableStatus.transferring,
    );
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_page", amount: 900 };
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [],
      has_more: true,
      url: "/v1/transfers",
    }));

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.uncertain, 1);
    assert.equal(createCalls, 0);
    pass("incomplete-pagination", "has_more without full scan blocks create");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Expired idempotency scenario: transferring + list finds prior transfer
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_exp`);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const payable = await seedPayable(
      employee.id,
      business.id,
      `${suffix}_exp`,
      EmployeeTipPayableStatus.transferring,
      { updatedAt: old },
    );
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (_params, options) => {
      createCalls += 1;
      assert.ok(options.idempotencyKey);
      return { id: `tr_would_duplicate_${suffix}`, amount: 900 };
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        transferFixture(
          payable.id,
          employee.id,
          business.id,
          payable.transactionId,
          empAcct,
          `tr_prior_${suffix}`,
        ),
      ],
      has_more: false,
      url: "/v1/transfers",
    }));

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.released, 1);
    assert.equal(createCalls, 0);
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.equal(row?.stripeTransferId, `tr_prior_${suffix}`);
    pass("expired-idempotency", "Stale transferring reconciled via list without create");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Stale transferring alert helper
  {
    const { manager, business, employee } = await seedEmployee(`${suffix}_stale`);
    const staleAt = new Date(Date.now() - 20 * 60 * 60 * 1000);
    await seedPayable(employee.id, business.id, `${suffix}_stale`, EmployeeTipPayableStatus.transferring, {
      updatedAt: staleAt,
    });
    const n = await warnStaleTransferringEmployeeTipPayables(10);
    assert.ok(n >= 1);
    pass("stale-alert", "warnStaleTransferringEmployeeTipPayables returns stale rows");
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Legacy transfer without caretip_payable_id metadata → manual reconcile
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_legacy`);
    const payable = await seedPayable(
      employee.id,
      business.id,
      `${suffix}_legacy`,
      EmployeeTipPayableStatus.transferring,
    );
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: "tr_legacy_bad", amount: 900 };
    });
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        {
          id: `tr_legacy_${suffix}`,
          object: "transfer",
          amount: 900,
          currency: "eur",
          destination: empAcct,
          source_transaction: `ch_lk_${suffix}_legacy`,
          metadata: {},
        } as Stripe.Transfer,
      ],
      has_more: false,
      url: "/v1/transfers",
    }));

    const result = await releaseHeldPlatformPayablesForEmployee(employee.id);
    assert.equal(result.uncertain, 1);
    assert.equal(createCalls, 0);
    const row = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    assert.match(row?.lastTransferError ?? "", /legacy_transfer_no_metadata/);
    pass("legacy-no-metadata", "Charge-linked transfer without metadata blocks create");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // Concurrent recovery on transferring payable (same process, mocked Stripe)
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_conc`);
    const payable = await seedPayable(
      employee.id,
      business.id,
      `${suffix}_conc`,
      EmployeeTipPayableStatus.transferring,
    );
    let createCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async () => {
      createCalls += 1;
      return { id: `tr_lk_conc_${suffix}`, amount: 900 };
    });
    installMockEmptyEmployeeTipTransferList();

    const [r1, r2] = await Promise.all([
      releaseHeldPlatformPayablesForEmployee(employee.id),
      releaseHeldPlatformPayablesForEmployee(employee.id),
    ]);
    assert.equal(r1.released + r2.released, 1);
    assert.equal(createCalls, 1);
    pass("concurrent-recovery", "Parallel release on transferring payable did not double-create");

    __setEmployeeTipTransferCreateFnForTests(null);
    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  // reconcile API uses lookup for transferring
  {
    const { manager, business, employee, empAcct } = await seedEmployee(`${suffix}_rec`);
    const payable = await seedPayable(
      employee.id,
      business.id,
      `${suffix}_rec`,
      EmployeeTipPayableStatus.transferring,
    );
    __setEmployeeTipReleaseTransferListFnForTests(async () => ({
      object: "list",
      data: [
        transferFixture(
          payable.id,
          employee.id,
          business.id,
          payable.transactionId,
          empAcct,
          `tr_rec_${suffix}`,
        ),
      ],
      has_more: false,
      url: "/v1/transfers",
    }));
    const outcome = await reconcileEmployeeTipReleaseTransfer({
      payableId: payable.id,
      employeeId: employee.id,
      destinationAccountId: empAcct,
    });
    assert.equal(outcome, "reconciled");
    pass("reconcile-lookup", "reconcileEmployeeTipReleaseTransfer persists via list");

    clearMockEmployeeTipStripeTransferList();
    await cleanup({ employeeId: employee.id, businessId: business.id, managerId: manager.id });
  }

  console.log("\nemployee-transfer-lookup-recovery-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
