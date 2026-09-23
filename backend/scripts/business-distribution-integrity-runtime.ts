/**
 * Business-distribution money-integrity regressions (no Stripe mutations).
 *
 *   npm run test:business-distribution-integrity
 */
import "dotenv/config";
import "../src/loadEnv.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  AGED_HELD_BUSINESS_DAYS_DEFAULT,
  businessDistributionObservabilityForBusiness,
  classifyCapturedPaymentIntentLedger,
  isBusinessDistributionPaymentIntentMetadata,
  scanBusinessDistributionLedgerIssues,
} from "../src/services/businessDistributionIntegrity.service.js";
import {
  createEmployeeTipPayableForSuccessfulTip,
} from "../src/services/employeeTipPayable.service.js";
import {
  __setEmployeeTipTransferCreateFnForTests,
  releaseHeldPlatformPayablesForEmployee,
} from "../src/services/employeeTipRelease.service.js";
import { resolveTipCheckoutRouting } from "../src/services/employeeTipRouting.service.js";

const backendRoot = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(backendRoot, relPath), "utf8");
}

function pass(id: string, msg: string) {
  console.log(`  ✓ ${id}: ${msg}`);
}

async function main() {
  const suffix = `bd_int_${Date.now()}`;
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: {
      email: `bd-int-mgr-${suffix}@example.com`,
      passwordHash,
      role: Role.MANAGER,
      emailVerified: true,
    },
  });
  const business = await prisma.business.create({
    data: {
      name: `BD Integrity ${suffix}`,
      slug: `bd-int-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_bd_int_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "BD Integrity Emp",
      jobTitle: "Staff",
      businessId: business.id,
      activationStatus: "active",
    },
  });

  await prisma.business.update({
    where: { id: business.id },
    data: { employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution },
  });
  const route = await resolveTipCheckoutRouting(business.id, employee.id);
  assert.equal(route.chargeModel, EmployeeTipChargeModel.destination_business);
  assert.equal(route.routingMode, EmployeeTipPayoutMode.business_distribution);
  pass("normal-routing", "business_distribution uses destination_business at checkout");

  const tip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_bd_int_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  await prisma.$transaction(async (tx) => {
    await createEmployeeTipPayableForSuccessfulTip({
      tx,
      transactionId: tip.id,
      employeeId: employee.id,
      businessId: business.id,
      paymentIntentId: `pi_bd_int_${suffix}`,
      grossCents: 1000,
      snapshot: {
        chargeModel: EmployeeTipChargeModel.destination_business,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        destinationAccountId: `acct_bd_int_biz_${suffix}`,
      },
      stripeChargeId: `ch_bd_int_${suffix}`,
      destinationTransferId: `tr_bd_int_dest_${suffix}`,
    });
  });
  const payable = await prisma.employeeTipPayable.findUnique({ where: { transactionId: tip.id } });
  assert.equal(payable?.status, EmployeeTipPayableStatus.held_business);
  pass("held-business-created", "destination charge creates held_business payable");

  const dupCount = await prisma.employeeTipPayable.count({ where: { transactionId: tip.id } });
  assert.equal(dupCount, 1);
  pass("ledger-idempotent", "single payable per transaction");

  let transferCalls = 0;
  __setEmployeeTipTransferCreateFnForTests(async () => {
    transferCalls += 1;
    return { id: `tr_bd_int_fail_${suffix}`, amount: 851 };
  });
  const release = await releaseHeldPlatformPayablesForEmployee(employee.id);
  assert.equal(release.released, 0);
  assert.equal(transferCalls, 0);
  pass("no-employee-release", "held_business not released via employee transfer path");

  await prisma.business.update({
    where: { id: business.id },
    data: { employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee },
  });
  const frozen = await prisma.employeeTipPayable.findUnique({ where: { id: payable!.id } });
  assert.equal(frozen?.routingMode, EmployeeTipPayoutMode.business_distribution);
  pass("mode-switch-frozen", "mode switch does not rewrite existing payable");

  await prisma.business.update({
    where: { id: business.id },
    data: {
      stripeAccountId: `acct_bd_int_biz_new_${suffix}`,
      employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution,
    },
  });
  const afterAcct = await prisma.employeeTipPayable.findUnique({ where: { id: payable!.id } });
  assert.equal(afterAcct?.stripeDestinationAccountId, `acct_bd_int_biz_${suffix}`);
  pass("acct-change-frozen", "business Stripe account change does not rewrite historical payable");

  const orphanPi = `pi_bd_int_orphan_${suffix}`;
  const orphanIssues = classifyCapturedPaymentIntentLedger({
    paymentIntent: {
      id: orphanPi,
      status: "succeeded",
      amount_received: 1000,
      amount: 1000,
      metadata: {
        employeeId: employee.id,
        businessId: business.id,
        caretipRoutingMode: EmployeeTipPayoutMode.business_distribution,
        caretipChargeModel: EmployeeTipChargeModel.destination_business,
      },
      transfer_data: { destination: `acct_bd_int_biz_new_${suffix}` },
    },
    business: { id: business.id, stripeAccountId: `acct_bd_int_biz_new_${suffix}` },
    employee: { id: employee.id, businessId: business.id },
    transaction: null,
    payable: null,
  });
  assert.ok(orphanIssues.some((row) => row.code === "orphan_captured_payment_intent"));
  pass("orphan-pi-detected", "captured PI without Transaction is flagged");

  const missingPayableTip = await prisma.transaction.create({
    data: {
      amount: 12,
      status: TipStatus.success,
      stripePaymentIntentId: `pi_bd_int_missing_pay_${suffix}`,
      employeeId: employee.id,
      businessId: business.id,
    },
  });
  const missingIssues = await scanBusinessDistributionLedgerIssues({ businessId: business.id });
  assert.ok(
    missingIssues.some(
      (row) =>
        row.code === "success_transaction_missing_payable" &&
        row.transactionId === missingPayableTip.id,
    ),
  );
  pass("txn-without-payable", "successful Transaction without payable is flagged");

  const mismatchIssues = classifyCapturedPaymentIntentLedger({
    paymentIntent: {
      id: payable!.stripePaymentIntentId,
      status: "succeeded",
      amount_received: 1000,
      amount: 1000,
      metadata: {
        employeeId: employee.id,
        businessId: business.id,
        caretipRoutingMode: EmployeeTipPayoutMode.business_distribution,
        caretipChargeModel: EmployeeTipChargeModel.destination_business,
      },
      transfer_data: { destination: `acct_bd_int_biz_${suffix}` },
    },
    business: { id: business.id, stripeAccountId: `acct_bd_int_biz_new_${suffix}` },
    employee: { id: employee.id, businessId: business.id },
    transaction: { id: tip.id, status: "success" },
    payable: payable!,
  });
  assert.ok(mismatchIssues.some((row) => row.code === "payable_destination_mismatch"));
  pass("destination-mismatch", "payable destination vs business account mismatch flagged");

  const crossTenant = classifyCapturedPaymentIntentLedger({
    paymentIntent: {
      id: `pi_bd_int_cross_${suffix}`,
      status: "succeeded",
      amount_received: 1000,
      amount: 1000,
      metadata: {
        employeeId: employee.id,
        businessId: "other-business",
        caretipRoutingMode: EmployeeTipPayoutMode.business_distribution,
      },
      transfer_data: { destination: `acct_bd_int_biz_${suffix}` },
    },
    business: { id: business.id, stripeAccountId: `acct_bd_int_biz_${suffix}` },
    employee: { id: employee.id, businessId: business.id },
    transaction: null,
    payable: null,
  });
  assert.ok(crossTenant.some((row) => row.code === "employee_business_mismatch"));
  pass("cross-tenant-reject", "metadata businessId mismatch is flagged");

  const scan1 = await scanBusinessDistributionLedgerIssues({ businessId: business.id });
  const scan2 = await scanBusinessDistributionLedgerIssues({ businessId: business.id });
  assert.equal(scan1.length, scan2.length);
  pass("scan-idempotent", "repeated scans return stable issue counts");

  assert.equal(
    isBusinessDistributionPaymentIntentMetadata({
      caretipRoutingMode: EmployeeTipPayoutMode.business_distribution,
    }),
    true,
  );
  pass("metadata-classifier", "business_distribution metadata recognized");

  const obs = await businessDistributionObservabilityForBusiness(business.id);
  assert.ok(obs.heldBusinessRowCount >= 1);
  assert.ok(obs.heldBusinessCents >= 851);
  pass("held-business-observability", "held_business totals exposed for business");

  const controller = read("src/controllers/employeeTipPayoutMode.controller.ts");
  assert.match(controller, /heldBusinessCents/);
  assert.match(controller, /businessDistributionObservabilityForBusiness/);
  pass("api-wiring", "routing overview exposes held_business observability");

  const releaseSrc = read("src/services/employeeTipRelease.service.ts");
  assert.match(releaseSrc, /EmployeeTipPayoutMode\.direct_to_employee/);
  assert.doesNotMatch(releaseSrc, /held_business/);
  pass("direct-routing-untouched", "employee release path unchanged");

  const webhook = read("src/webhooks/stripe.webhook.ts");
  assert.match(webhook, /markStripeWebhookEventProcessed/);
  pass("webhook-idempotency-present", "webhook idempotency unchanged");

  assert.ok(AGED_HELD_BUSINESS_DAYS_DEFAULT >= 7);
  pass("aged-threshold", "aged held_business threshold configured");

  await prisma.employeeTipPayable.deleteMany({ where: { businessId: business.id } });
  await prisma.transaction.deleteMany({ where: { businessId: business.id } });
  await prisma.employee.delete({ where: { id: employee.id } });
  await prisma.business.delete({ where: { id: business.id } });
  await prisma.user.delete({ where: { id: manager.id } });
  __setEmployeeTipTransferCreateFnForTests(null);

  console.log("business-distribution-integrity-runtime: OK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
