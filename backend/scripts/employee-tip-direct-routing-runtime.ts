/**
 * Direct-to-employee routing + payable ledger + release idempotency.
 * Run: npm run test:employee-tip-direct-routing
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayoutMode,
  EmployeeTipPayableStatus,
  Role,
  StripeConnectStatus,
  TipStatus,
} from "@prisma/client";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { calculateTipPlatformFeeCents, CARETIP_FEE_PERCENT, CARETIP_FEE_FIXED_CENTS_EUR } from "../src/config/fees.js";
import { remainingPayableCents, routingModeFromClient, applyRefundToEmployeePayable } from "../src/services/employeeTipPayable.service.js";
import { isEmployeeRecipientReady, resolveTipCheckoutRouting } from "../src/services/employeeTipRouting.service.js";
import {
  releaseHeldPlatformPayablesForEmployee,
  __setEmployeeTipTransferCreateFnForTests,
  __setEmployeeTipTransferReversalFnForTests,
} from "../src/services/employeeTipRelease.service.js";
import { upsertStripeRefundEvent } from "../src/services/finance/tipRefunds.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string) {
  results.push({ id: id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id: id, pass: false, detail });
}
function read(relPath: string): string {
  return readFileSync(join(backendRoot, relPath), "utf8");
}

function runStatic() {
  const fees = read("src/config/fees.ts");
  const checkout = read("src/services/stripe.service.ts");
  const instant = read("src/services/stripeConnectInstantPayout.service.ts");
  const pentest = read("scripts/payment-pentest.ts");

  if (CARETIP_FEE_PERCENT === 10 && CARETIP_FEE_FIXED_CENTS_EUR === 49) {
    pass("fee-constants", "10% + €0.49 unchanged");
  } else {
    fail("fee-constants", `${CARETIP_FEE_PERCENT} ${CARETIP_FEE_FIXED_CENTS_EUR}`);
  }
  if (calculateTipPlatformFeeCents(1000) === 149) {
    pass("fee-example-10eur", "€10.00 → €1.49 fee → €8.51 payable");
  } else {
    fail("fee-example-10eur", String(calculateTipPlatformFeeCents(1000)));
  }
  if (calculateTipPlatformFeeCents(2000) === 249) {
    pass("fee-example-20eur", "€20.00 → €2.49 fee → €17.51 payable");
  } else {
    fail("fee-example-20eur", String(calculateTipPlatformFeeCents(2000)));
  }
  const release = read("src/services/employeeTipRelease.service.ts");
  if (
    release.includes("chargeModel: EmployeeTipChargeModel.platform_hold") &&
    release.includes("emp_tip_release:")
  ) {
    pass("release-platform-hold-only", "Release Transfers are limited to platform_hold payables");
  } else {
    fail("release-platform-hold-only", "release filter missing");
  }
  const connectRoutes = read("src/routes/connect.routes.ts");
  if (
    connectRoutes.includes("requireRole(Role.MANAGER)") &&
    connectRoutes.includes("employee-tip-payout-mode")
  ) {
    pass("mode-route-manager-only", "Payout mode routes require manager JWT");
  } else {
    fail("mode-route-manager-only", "manager guard missing");
  }
  const empRoutes = read("src/routes/employeeConnect.routes.ts");
  if (!empRoutes.includes("employee-tip-payout-mode")) {
    pass("employee-cannot-patch-mode-route", "Employee Connect routes do not expose routing mode");
  } else {
    fail("employee-cannot-patch-mode-route", "mode route leaked to employee");
  }
  if (fees.includes("CARETIP_FEE_PERCENT") && checkout.includes("calculateTipPlatformFeeCents")) {
    pass("fee-wired", "Checkout still uses calculateTipPlatformFeeCents");
  } else {
    fail("fee-wired", "fee wiring missing");
  }
  if (checkout.includes("reverse_transfer: true") && checkout.includes("refund_application_fee: true")) {
    pass("dest-refund-flags", "Destination refunds still reverse transfer + application fee");
  } else {
    fail("dest-refund-flags", "refund flags missing");
  }
  if (instant.includes("createInstantPayoutForBusiness") && !instant.includes("createInstantPayoutForEmployee")) {
    pass("no-employee-instant", "Employee Instant Payout not mixed into Business Instant");
  } else {
    fail("no-employee-instant", "Instant service changed unexpectedly");
  }
  if (remainingPayableCents({ payableCents: 851, transferredCents: 0, reversedCents: 0, refundedCents: 100 }) === 751) {
    pass("remaining-cents", "Integer remaining payable");
  } else {
    fail("remaining-cents", "remaining math");
  }
  if (
    routingModeFromClient("direct_to_employee") === EmployeeTipPayoutMode.direct_to_employee &&
    routingModeFromClient("business_distribution") === EmployeeTipPayoutMode.business_distribution &&
    routingModeFromClient("acct_x") === null
  ) {
    pass("mode-parse", "Client mode enum is allowlisted");
  } else {
    fail("mode-parse", "mode parse");
  }
  if (pentest.includes("TIP_CONNECT_CLIENT_FORBIDDEN_KEYS")) {
    pass("pentest-still-forbids-client-dest", "Payment pentest still forbids client destination keys");
  } else {
    fail("pentest-still-forbids-client-dest", "pentest guard missing");
  }
}

async function runDb() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("Testpass1!", 4);
  const manager = await prisma.user.create({
    data: { email: `rt_mgr_${suffix}@example.com`, passwordHash, role: Role.MANAGER, emailVerified: true },
  });
  const userEmp = await prisma.user.create({
    data: { email: `rt_emp_${suffix}@example.com`, passwordHash, role: Role.EMPLOYEE, emailVerified: true },
  });
  const business = await prisma.business.create({
    data: {
      name: `Routing ${suffix}`,
      slug: `routing-${suffix}`,
      userId: manager.id,
      stripeAccountId: `acct_rt_biz_${suffix}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      name: "Router",
      jobTitle: "Server",
      businessId: business.id,
      userId: userEmp.id,
      activationStatus: "active",
      isActive: true,
    },
  });

  try {
    const unconnected = await resolveTipCheckoutRouting(business.id, employee.id);
    if (
      unconnected.chargeModel === EmployeeTipChargeModel.platform_hold &&
      unconnected.destinationAccountId === null
    ) {
      pass("unconnected-platform-hold", "Direct default + unconnected employee holds on platform");
    } else {
      fail("unconnected-platform-hold", JSON.stringify(unconnected));
    }

    await prisma.employeeStripeAccount.create({
      data: {
        employeeId: employee.id,
        stripeAccountId: `acct_rt_emp_${suffix}`,
        stripeConnectStatus: StripeConnectStatus.ready,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
      },
    });
    if (
      !isEmployeeRecipientReady({
        stripeAccountId: `acct_rt_emp_${suffix}`,
        stripeConnectStatus: StripeConnectStatus.onboarding_required,
        stripePayoutsEnabled: true,
      })
    ) {
      pass("recipient-not-ready-until-status", "Onboarding status is not treated as ready");
    } else {
      fail("recipient-not-ready-until-status", "false ready");
    }

    const connected = await resolveTipCheckoutRouting(business.id, employee.id);
    if (
      connected.chargeModel === EmployeeTipChargeModel.destination_employee &&
      connected.destinationAccountId === `acct_rt_emp_${suffix}`
    ) {
      pass("connected-employee-destination", "Ready employee is Checkout destination");
    } else {
      fail("connected-employee-destination", JSON.stringify(connected));
    }

    await prisma.business.update({
      where: { id: business.id },
      data: { employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution },
    });
    const businessFirst = await resolveTipCheckoutRouting(business.id, employee.id);
    if (
      businessFirst.chargeModel === EmployeeTipChargeModel.destination_business &&
      businessFirst.destinationAccountId === `acct_rt_biz_${suffix}`
    ) {
      pass("business-distribution-destination", "Business-first mode still destinations to venue Connect");
    } else {
      fail("business-distribution-destination", JSON.stringify(businessFirst));
    }

    const tip = await prisma.transaction.create({
      data: {
        amount: 10,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_rt_${suffix}`,
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
        platformFeeCents: 149,
        payableCents: 851,
        stripePaymentIntentId: `pi_rt_${suffix}`,
        stripeChargeId: `ch_rt_${suffix}`,
      },
    });

    let transferCalls = 0;
    __setEmployeeTipTransferCreateFnForTests(async (params, options) => {
      transferCalls += 1;
      if (params.destination !== `acct_rt_emp_${suffix}`) throw new Error("wrong dest");
      if (params.amount !== 851) throw new Error("wrong amount");
      if (options.idempotencyKey !== `emp_tip_release:${payable.id}`) throw new Error("missing idempotency");
      return { id: `tr_rt_${suffix}`, amount: 851 };
    });

    const first = await releaseHeldPlatformPayablesForEmployee(employee.id);
    const second = await releaseHeldPlatformPayablesForEmployee(employee.id);
    const after = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    if (first.released === 1 && second.released === 0 && transferCalls === 1 && after?.stripeTransferId === `tr_rt_${suffix}`) {
      pass("release-idempotent", "Second release did not create a second transfer");
    } else {
      fail(
        "release-idempotent",
        JSON.stringify({ first, second, transferCalls, transferId: after?.stripeTransferId }),
      );
    }

    const concurrent = await Promise.all([
      releaseHeldPlatformPayablesForEmployee(employee.id),
      releaseHeldPlatformPayablesForEmployee(employee.id),
    ]);
    if (concurrent.every((r) => r.released === 0) && transferCalls === 1) {
      pass("release-concurrent", "Serialized release did not double-transfer");
    } else {
      fail("release-concurrent", JSON.stringify({ concurrent, transferCalls }));
    }

    const frozenMode = after?.routingMode;
    await prisma.business.update({
      where: { id: business.id },
      data: { employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee },
    });
    const afterSwitch = await prisma.employeeTipPayable.findUnique({ where: { id: payable.id } });
    if (
      frozenMode === EmployeeTipPayoutMode.direct_to_employee &&
      afterSwitch?.routingMode === EmployeeTipPayoutMode.direct_to_employee &&
      afterSwitch.chargeModel === EmployeeTipChargeModel.platform_hold
    ) {
      pass("mode-switch-does-not-rewrite-payable", "Existing payable routing/charge model stayed frozen");
    } else {
      fail("mode-switch-does-not-rewrite-payable", JSON.stringify(afterSwitch));
    }

    await prisma.employeeStripeAccount.delete({ where: { employeeId: employee.id } });
    await prisma.business.update({
      where: { id: business.id },
      data: { employeeTipPayoutMode: EmployeeTipPayoutMode.business_distribution },
    });
    const bizUnconnected = await resolveTipCheckoutRouting(business.id, employee.id);
    if (
      bizUnconnected.chargeModel === EmployeeTipChargeModel.destination_business &&
      bizUnconnected.destinationAccountId === `acct_rt_biz_${suffix}`
    ) {
      pass("business-distribution-unconnected", "Business-first unconnected staff still destination to Business");
    } else {
      fail("business-distribution-unconnected", JSON.stringify(bizUnconnected));
    }

    const bizHeld = await prisma.employeeTipPayable.create({
      data: {
        transactionId: (
          await prisma.transaction.create({
            data: {
              amount: 10,
              status: TipStatus.success,
              stripePaymentIntentId: `pi_rt_biz_${suffix}`,
              employeeId: employee.id,
              businessId: business.id,
            },
          })
        ).id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode: EmployeeTipPayoutMode.business_distribution,
        chargeModel: EmployeeTipChargeModel.destination_business,
        status: EmployeeTipPayableStatus.held_business,
        grossCents: 1000,
        platformFeeCents: 149,
        payableCents: 851,
        stripePaymentIntentId: `pi_rt_biz_${suffix}`,
      },
    });
    const beforeBizReleaseCalls = transferCalls;
    const bizRelease = await releaseHeldPlatformPayablesForEmployee(employee.id);
    if (bizRelease.released === 0 && transferCalls === beforeBizReleaseCalls) {
      pass("business-held-not-transferred", "held_business payables are not Transfer-released");
    } else {
      fail("business-held-not-transferred", JSON.stringify({ bizRelease, transferCalls }));
    }

    await prisma.employeeStripeAccount.create({
      data: {
        employeeId: employee.id,
        stripeAccountId: `acct_rt_emp_${suffix}`,
        stripeConnectStatus: StripeConnectStatus.ready,
        stripePayoutsEnabled: true,
        stripeDetailsSubmitted: true,
      },
    });

    const holdTip = await prisma.transaction.create({
      data: {
        amount: 10,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_rt_hold_${suffix}`,
        employeeId: employee.id,
        businessId: business.id,
      },
    });
    const holdPayable = await prisma.employeeTipPayable.create({
      data: {
        transactionId: holdTip.id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        status: EmployeeTipPayableStatus.held_platform,
        grossCents: 1000,
        platformFeeCents: 149,
        payableCents: 851,
        stripePaymentIntentId: `pi_rt_hold_${suffix}`,
        stripeChargeId: `ch_rt_hold_${suffix}`,
      },
    });
    await applyRefundToEmployeePayable({ transactionId: holdTip.id, refundedCents: 100 });
    const afterPartial = await prisma.employeeTipPayable.findUnique({ where: { id: holdPayable.id } });
    if (
      afterPartial?.refundedCents === 100 &&
      afterPartial.status === EmployeeTipPayableStatus.held_platform &&
      remainingPayableCents(afterPartial) === 751
    ) {
      pass("refund-before-transfer-partial", "Partial refund reduces held remaining to €7.51");
    } else {
      fail("refund-before-transfer-partial", JSON.stringify(afterPartial));
    }
    const netTransferCalls = { n: 0 };
    __setEmployeeTipTransferCreateFnForTests(async (params) => {
      netTransferCalls.n += 1;
      if (params.amount !== 751) throw new Error(`expected 751 got ${params.amount}`);
      if (params.source_transaction !== `ch_rt_hold_${suffix}`) throw new Error("missing source_transaction");
      return { id: `tr_rt_hold_${suffix}`, amount: 751 };
    });
    const netRelease = await releaseHeldPlatformPayablesForEmployee(employee.id);
    if (netRelease.released === 1 && netTransferCalls.n === 1) {
      pass("transfer-net-after-partial-refund", "Transfer amount is remaining payable, not gross");
    } else {
      fail("transfer-net-after-partial-refund", JSON.stringify({ netRelease, calls: netTransferCalls.n }));
    }

    const failTip = await prisma.transaction.create({
      data: {
        amount: 20,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_rt_fail_${suffix}`,
        employeeId: employee.id,
        businessId: business.id,
      },
    });
    const failPayable = await prisma.employeeTipPayable.create({
      data: {
        transactionId: failTip.id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        status: EmployeeTipPayableStatus.held_platform,
        grossCents: 2000,
        platformFeeCents: 249,
        payableCents: 1751,
        stripePaymentIntentId: `pi_rt_fail_${suffix}`,
        stripeChargeId: `ch_rt_fail_${suffix}`,
      },
    });
    let failAttempts = 0;
    __setEmployeeTipTransferCreateFnForTests(async (params) => {
      failAttempts += 1;
      if (params.amount !== 1751) throw new Error(`expected 1751 got ${params.amount}`);
      if (failAttempts === 1) throw new Error("stripe_transfer_temporary");
      return { id: `tr_rt_fail_${suffix}`, amount: 1751 };
    });
    const failed = await releaseHeldPlatformPayablesForEmployee(employee.id);
    const afterFail = await prisma.employeeTipPayable.findUnique({ where: { id: failPayable.id } });
    const retried = await releaseHeldPlatformPayablesForEmployee(employee.id);
    const afterRetry = await prisma.employeeTipPayable.findUnique({ where: { id: failPayable.id } });
    if (
      failed.released === 0 &&
      afterFail?.status === EmployeeTipPayableStatus.transfer_failed &&
      afterFail.stripeTransferId == null &&
      retried.released === 1 &&
      afterRetry?.stripeTransferId === `tr_rt_fail_${suffix}`
    ) {
      pass("failed-transfer-then-retry", "Failed transfer stays retryable and then persists Stripe transfer id");
    } else {
      fail(
        "failed-transfer-then-retry",
        JSON.stringify({ failed, afterFail, retried, afterRetry, failAttempts }),
      );
    }

    let reversalCalls = 0;
    __setEmployeeTipTransferReversalFnForTests(async (_id, params) => {
      reversalCalls += 1;
      if (params.amount !== 1751) throw new Error(`reversal ${params.amount}`);
      return { id: `trr_rt_${suffix}`, amount: 1751 };
    });
    await applyRefundToEmployeePayable({ transactionId: failTip.id, refundedCents: 1751 });
    const afterPostTransferRefund = await prisma.employeeTipPayable.findUnique({
      where: { id: failPayable.id },
    });
    if (
      reversalCalls === 1 &&
      afterPostTransferRefund?.status === EmployeeTipPayableStatus.refunded &&
      afterPostTransferRefund.reversedCents === 1751 &&
      afterPostTransferRefund.refundedCents === 1751
    ) {
      pass("refund-after-transfer-reverses", "Refund after Transfer reverses the employee Transfer");
    } else {
      fail("refund-after-transfer-reverses", JSON.stringify({ reversalCalls, afterPostTransferRefund }));
    }

    const destTip = await prisma.transaction.create({
      data: {
        amount: 10,
        status: TipStatus.success,
        stripePaymentIntentId: `pi_rt_dest_${suffix}`,
        employeeId: employee.id,
        businessId: business.id,
      },
    });
    const destPayable = await prisma.employeeTipPayable.create({
      data: {
        transactionId: destTip.id,
        employeeId: employee.id,
        businessId: business.id,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        chargeModel: EmployeeTipChargeModel.destination_employee,
        status: EmployeeTipPayableStatus.destination_settled,
        grossCents: 1000,
        platformFeeCents: 149,
        payableCents: 851,
        transferredCents: 851,
        stripePaymentIntentId: `pi_rt_dest_${suffix}`,
        stripeTransferId: `tr_rt_dest_${suffix}`,
      },
    });
    const destReleaseCalls = { n: 0 };
    __setEmployeeTipTransferCreateFnForTests(async () => {
      destReleaseCalls.n += 1;
      return { id: `tr_should_not_${suffix}`, amount: 1 };
    });
    await releaseHeldPlatformPayablesForEmployee(employee.id);
    await applyRefundToEmployeePayable({ transactionId: destTip.id, refundedCents: 200 });
    const destAfter = await prisma.employeeTipPayable.findUnique({ where: { id: destPayable.id } });
    if (
      destReleaseCalls.n === 0 &&
      destAfter?.status === EmployeeTipPayableStatus.destination_settled &&
      destAfter.refundedCents === 200
    ) {
      pass("dest-partial-refund-keeps-settled", "Partial destination refund does not mark fully refunded or re-transfer");
    } else {
      fail("dest-partial-refund-keeps-settled", JSON.stringify({ destReleaseCalls, destAfter }));
    }

    await upsertStripeRefundEvent({
      stripeRefundId: `re_rt_${suffix}`,
      stripePaymentIntentId: `pi_rt_dest_${suffix}`,
      amountCents: 200,
      status: "succeeded",
      occurredAt: new Date(),
      businessId: business.id,
      tipId: destTip.id,
    });
    await upsertStripeRefundEvent({
      stripeRefundId: `re_rt_${suffix}`,
      stripePaymentIntentId: `pi_rt_dest_${suffix}`,
      amountCents: 200,
      status: "succeeded",
      occurredAt: new Date(),
      businessId: business.id,
      tipId: destTip.id,
    });
    const destDup = await prisma.employeeTipPayable.findUnique({ where: { id: destPayable.id } });
    if (destDup?.refundedCents === 400) {
      pass("duplicate-refund-event-not-double-counted", "Second succeeded upsert of the same Stripe refund is ignored");
    } else {
      fail("duplicate-refund-event-not-double-counted", String(destDup?.refundedCents));
    }

    const otherMgr = await prisma.user.create({
      data: { email: `rt_mgr2_${suffix}@example.com`, passwordHash, role: Role.MANAGER, emailVerified: true },
    });
    const otherBiz = await prisma.business.create({
      data: {
        name: `Other ${suffix}`,
        slug: `routing-o-${suffix}`,
        userId: otherMgr.id,
        stripeAccountId: `acct_rt_obiz_${suffix}`,
        stripeConnectStatus: StripeConnectStatus.ready,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
      },
    });
    const otherUser = await prisma.user.create({
      data: { email: `rt_emp2_${suffix}@example.com`, passwordHash, role: Role.EMPLOYEE, emailVerified: true },
    });
    const otherEmp = await prisma.employee.create({
      data: {
        name: "Other",
        jobTitle: "Server",
        businessId: otherBiz.id,
        userId: otherUser.id,
        activationStatus: "active",
        isActive: true,
      },
    });
    await prisma.employeeStripeAccount.create({
      data: {
        employeeId: otherEmp.id,
        stripeAccountId: `acct_rt_oemp_${suffix}`,
        stripeConnectStatus: StripeConnectStatus.ready,
        stripePayoutsEnabled: true,
      },
    });
    const otherRouting = await resolveTipCheckoutRouting(otherBiz.id, otherEmp.id);
    if (otherRouting.destinationAccountId === `acct_rt_oemp_${suffix}`) {
      pass("cross-tenant-destination-isolated", "Other business employee destinations to their own acct_");
    } else {
      fail("cross-tenant-destination-isolated", JSON.stringify(otherRouting));
    }
    const leak = await releaseHeldPlatformPayablesForEmployee(otherEmp.id);
    if (leak.released === 0) {
      pass("cross-tenant-release-empty", "Other employee release cannot move this tenant's payables");
    } else {
      fail("cross-tenant-release-empty", JSON.stringify(leak));
    }

    await prisma.employeeTipPayable.deleteMany({
      where: { employeeId: { in: [employee.id, otherEmp.id] } },
    });
    await prisma.tipRefund.deleteMany({
      where: { businessId: { in: [business.id, otherBiz.id] } },
    });
    await prisma.transaction.deleteMany({
      where: { businessId: { in: [business.id, otherBiz.id] } },
    });
    await prisma.employeeStripeAccount.deleteMany({
      where: { employeeId: { in: [employee.id, otherEmp.id] } },
    });
    await prisma.employee.deleteMany({ where: { id: { in: [employee.id, otherEmp.id] } } });
    await prisma.business.deleteMany({ where: { id: { in: [business.id, otherBiz.id] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [manager.id, userEmp.id, otherMgr.id, otherUser.id] } },
    });
    __setEmployeeTipTransferReversalFnForTests(null);
    return;
  } finally {
    __setEmployeeTipTransferCreateFnForTests(null);
    await prisma.employeeTipPayable.deleteMany({ where: { employeeId: employee.id } });
    await prisma.transaction.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.business.deleteMany({ where: { id: business.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, userEmp.id] } } });
  }
}

async function main() {
  runStatic();
  try {
    await runDb();
  } catch (err) {
    fail("db-suite", err instanceof Error ? err.message : String(err));
  }
  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}  ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

void main();
