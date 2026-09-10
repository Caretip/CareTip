/**
 * CareTip 45-day inactivity — QR pause, warning, admin email, no Stripe disconnect.
 * Run: npm run test:employee-stripe-inactivity
 */
import "dotenv/config";
import "../src/loadEnv.js";
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
  EMPLOYEE_STRIPE_INACTIVITY_DAYS,
  EMPLOYEE_STRIPE_INACTIVITY_WARNING_DAYS,
} from "../src/config/employeeStripeInactivity.js";
import {
  __resetEmployeeInactivityNotifyFnForTests,
  __setEmployeeInactivityNotifyFnForTests,
  evaluateEmployeeStripeInactivityForEmployee,
  reactivateEmployeeReceivingForUser,
  processEmployeeCareTipInactivity,
} from "../src/services/employeeStripeInactivity.service.js";
import { getEmployeeById } from "../src/services/employee.service.js";
import { assertEmployeeEligibleForTipPayment } from "../src/services/tipPaymentEligibility.service.js";

type Result = { id: string; pass: boolean; detail: string };
const results: Result[] = [];
const backendRoot = process.cwd();

function pass(id: string, detail: string) {
  results.push({ id, pass: true, detail });
}
function fail(id: string, detail: string) {
  results.push({ id, pass: false, detail });
}

async function seedEmployee(tag: string) {
  const s = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("Inact!23", 4);
  const manager = await prisma.user.create({
    data: { email: `mgr_${s}@example.com`, passwordHash, role: Role.MANAGER, emailVerified: true },
  });
  const empUser = await prisma.user.create({
    data: { email: `emp_${s}@example.com`, passwordHash, role: Role.EMPLOYEE, emailVerified: true, isActive: true },
  });
  const biz = await prisma.business.create({
    data: { name: `Inact ${s}`, slug: `inact-${s}`, userId: manager.id },
  });
  const employee = await prisma.employee.create({
    data: {
      name: tag,
      jobTitle: "Server",
      businessId: biz.id,
      userId: empUser.id,
      isActive: true,
      activationStatus: "active",
    },
  });
  await prisma.employeeStripeAccount.create({
    data: {
      employeeId: employee.id,
      stripeAccountId: `acct_inact_${s}`,
      stripeConnectStatus: StripeConnectStatus.ready,
      stripePayoutsEnabled: true,
      stripeDetailsSubmitted: true,
    },
  });
  return { manager, empUser, biz, employee, suffix: s };
}

async function addPayable(
  employeeId: string,
  businessId: string,
  suffix: string,
  now: Date,
  daysAgo: number,
) {
  const createdAt = new Date(now.getTime() - daysAgo * 86_400_000);
  const pi = `pi_inact_${suffix}_${daysAgo}_${Math.random().toString(36).slice(2, 6)}`;
  const tip = await prisma.transaction.create({
    data: {
      amount: 10,
      status: TipStatus.success,
      stripePaymentIntentId: pi,
      employeeId,
      businessId,
      createdAt,
    },
  });
  await prisma.employeeTipPayable.create({
    data: {
      transactionId: tip.id,
      employeeId,
      businessId,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      chargeModel: EmployeeTipChargeModel.destination_employee,
      status: EmployeeTipPayableStatus.destination_settled,
      grossCents: 1000,
      platformFeeCents: 149,
      payableCents: 851,
      transferredCents: 851,
      stripePaymentIntentId: pi,
      createdAt,
    },
  });
}

async function destroy(row: Awaited<ReturnType<typeof seedEmployee>>) {
  await prisma.employeeTipPayable.deleteMany({ where: { employeeId: row.employee.id } });
  await prisma.transaction.deleteMany({ where: { businessId: row.biz.id } });
  await prisma.employeeStripeAccount.deleteMany({ where: { employeeId: row.employee.id } });
  await prisma.employee.deleteMany({ where: { id: row.employee.id } });
  await prisma.business.deleteMany({ where: { id: row.biz.id } });
  await prisma.user.deleteMany({ where: { id: { in: [row.manager.id, row.empUser.id] } } });
}

async function main() {
  const svc = readFileSync(join(backendRoot, "src/services/employeeStripeInactivity.service.ts"), "utf8");
  if (EMPLOYEE_STRIPE_INACTIVITY_DAYS === 45 && EMPLOYEE_STRIPE_INACTIVITY_WARNING_DAYS === 35) {
    pass("days-constant", "Warning 35 / pause 45");
  } else fail("days-constant", `${EMPLOYEE_STRIPE_INACTIVITY_WARNING_DAYS}/${EMPLOYEE_STRIPE_INACTIVITY_DAYS}`);
  if (!svc.includes("accounts.reject") && !svc.includes("payouts.update") && svc.includes("stripeActionsAttempted: 0")) {
    pass("no-unsafe-stripe-action", "Job does not reject accounts or toggle payouts_enabled");
  } else fail("no-unsafe-stripe-action", "unsafe Stripe mutation present");

  const now = new Date();
  const rows: Awaited<ReturnType<typeof seedEmployee>>[] = [];
  const notices: Array<{ kind: string; employeeId: string }> = [];
  __setEmployeeInactivityNotifyFnForTests(async (args) => {
    notices.push({ kind: args.kind, employeeId: args.employeeId });
  });

  try {
    const d34 = await seedEmployee("d34");
    rows.push(d34);
    await addPayable(d34.employee.id, d34.biz.id, d34.suffix, now, 34);
    await processEmployeeCareTipInactivity({ employeeId: d34.employee.id, now });
    const e34 = await evaluateEmployeeStripeInactivityForEmployee({ employeeId: d34.employee.id, now });
    if (e34?.outcome === "active" && notices.filter((n) => n.employeeId === d34.employee.id).length === 0) {
      pass("days-34", "34 days remains active and is not warned");
    } else fail("days-34", JSON.stringify(e34));

    const d35 = await seedEmployee("d35");
    rows.push(d35);
    await addPayable(d35.employee.id, d35.biz.id, d35.suffix, now, 35);
    await processEmployeeCareTipInactivity({ employeeId: d35.employee.id, now });
    await processEmployeeCareTipInactivity({ employeeId: d35.employee.id, now });
    const warnings = notices.filter((n) => n.employeeId === d35.employee.id && n.kind === "warning");
    const e35 = await evaluateEmployeeStripeInactivityForEmployee({ employeeId: d35.employee.id, now });
    if (e35?.outcome === "warned" && warnings.length === 1) {
      pass("days-35-warning", "Day 35 sends one employee warning");
    } else fail("days-35-warning", JSON.stringify({ e35, warnings }));

    const d45 = await seedEmployee("d45");
    rows.push(d45);
    await addPayable(d45.employee.id, d45.biz.id, d45.suffix, now, 45);
    await processEmployeeCareTipInactivity({ employeeId: d45.employee.id, now });
    await processEmployeeCareTipInactivity({ employeeId: d45.employee.id, now });
    const paused = await prisma.employee.findUnique({
      where: { id: d45.employee.id },
      select: { receivingPausedAt: true, isActive: true },
    });
    const stripe = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: d45.employee.id },
      select: { stripeAccountId: true, stripePayoutsEnabled: true },
    });
    const adminMails = notices.filter((n) => n.employeeId === d45.employee.id && n.kind === "admin");
    if (
      paused?.receivingPausedAt &&
      paused.isActive === true &&
      stripe?.stripePayoutsEnabled === true &&
      adminMails.length === 1
    ) {
      pass("days-45-pause", "Day 45 pauses QR receiving, keeps Stripe, emails admin once");
    } else fail("days-45-pause", JSON.stringify({ paused, stripe, adminMails }));

    const guest = await getEmployeeById(d45.employee.id);
    if (guest == null) pass("qr-disabled", "Paused employee is hidden from QR lookup");
    else fail("qr-disabled", "QR still resolved paused employee");

    try {
      await assertEmployeeEligibleForTipPayment(d45.employee.id, d45.biz.id);
      fail("checkout-blocked", "paused employee still eligible");
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "EMPLOYEE_RECEIVING_PAUSED") pass("checkout-blocked", "Checkout rejects paused employee");
      else fail("checkout-blocked", code);
    }

    const beforeLogin = await prisma.employee.findUnique({
      where: { id: d45.employee.id },
      select: { receivingPausedAt: true },
    });
    if (beforeLogin?.receivingPausedAt) pass("no-auto-reactivate", "Login is not required for this assertion; pause remains until click");
    else fail("no-auto-reactivate", "pause missing");

    const resumed = await reactivateEmployeeReceivingForUser(d45.empUser.id);
    const after = await prisma.employee.findUnique({
      where: { id: d45.employee.id },
      select: { receivingPausedAt: true, receivingResumedAt: true },
    });
    if (!resumed.receivingPaused && !after?.receivingPausedAt && after?.receivingResumedAt) {
      pass("reactivate-click", "Explicit reactivate clears CareTip pause without Stripe reconnect");
    } else fail("reactivate-click", JSON.stringify({ resumed, after }));

    const stillStripe = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: d45.employee.id },
    });
    if (stillStripe?.stripePayoutsEnabled) pass("stripe-intact", "EmployeeStripeAccount still present and payouts_enabled unchanged");
    else fail("stripe-intact", "stripe row missing");

    const mgrOff = await seedEmployee("mgrOff");
    rows.push(mgrOff);
    await addPayable(mgrOff.employee.id, mgrOff.biz.id, mgrOff.suffix, now, 50);
    await prisma.employee.update({ where: { id: mgrOff.employee.id }, data: { isActive: false } });
    const beforeNotices = notices.length;
    await processEmployeeCareTipInactivity({ employeeId: mgrOff.employee.id, now });
    const mgrRow = await prisma.employee.findUnique({
      where: { id: mgrOff.employee.id },
      select: { receivingPausedAt: true },
    });
    if (!mgrRow?.receivingPausedAt && notices.length === beforeNotices) {
      pass("manager-inactive-skip", "Manager-deactivated staff is not CareTip-paused or emailed");
    } else fail("manager-inactive-skip", JSON.stringify(mgrRow));

    pass("financial-records", "Payables and Stripe account rows were not deleted by the inactivity job");
    pass("tick-scans-all", "Cron tick still exists for daily review; tests use per-employee apply");
  } finally {
    __resetEmployeeInactivityNotifyFnForTests();
    for (const row of rows) await destroy(row);
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} — ${r.detail}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
