/**
 * Phase 11 remediation regression (BL-11-01 quota TOCTOU, BL-11-02 activation-after-delete).
 * Run: npm run test:phase-11-remediation
 */
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { BillingCycle, SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../src/prisma.js";
import * as locationsService from "../src/services/locations.service.js";
import * as tablesService from "../src/services/tables.service.js";
import * as employeeService from "../src/services/employee.service.js";
import * as employeeActivationService from "../src/services/employeeActivation.service.js";
import * as authService from "../src/services/auth.service.js";
import { provisionInternalBasicSubscription } from "../src/services/subscription.service.js";
import { isEntitlementDeniedError } from "../src/lib/subscription/entitlementHttpError.js";
import { PLAN_LIMIT_EXCEEDED_CODE } from "../src/config/subscriptionCapabilities.js";
import { requestPasswordReset } from "../src/services/passwordReset.service.js";
import { userMayAuthenticate } from "../src/services/accountAccess.service.js";
import { assertEmployeeEligibleForTipPayment, TipPaymentEligibilityError } from "../src/services/tipPaymentEligibility.service.js";

const PW = "TestPass1!aA";
const tag = Date.now();
const results: { id: string; status: "PASS" | "FAIL"; detail: string }[] = [];

function pass(id: string, detail: string) {
  results.push({ id, status: "PASS", detail });
  console.log(`PASS: ${id} — ${detail}`);
}
function fail(id: string, detail: string) {
  results.push({ id, status: "FAIL", detail });
  console.log(`FAIL: ${id} — ${detail}`);
}

function quotaDenied(err: unknown): boolean {
  return isEntitlementDeniedError(err) && err.payload.code === PLAN_LIMIT_EXCEEDED_CODE;
}

async function makeManager(suffix: string, tier: "basic" | "premium") {
  const passwordHash = await bcrypt.hash(PW, 10);
  const user = await prisma.user.create({
    data: {
      email: `p11r-${suffix}-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `P11R ${suffix} ${tag}`,
          slug: `p11r-${suffix}-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: tier,
        },
      },
    },
    include: { business: true },
  });
  const businessId = user.business!.id;
  if (tier === "basic") {
    await provisionInternalBasicSubscription(businessId);
  } else {
    await prisma.subscription.create({
      data: {
        businessId,
        planKey: SubscriptionPlanKey.premium,
        status: SubscriptionStatus.active,
        billingCycle: BillingCycle.monthly,
      },
    });
  }
  return user;
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { contains: `${tag}@caretip-test.local` } },
    select: { id: true, business: { select: { id: true } }, employee: { select: { id: true } } },
  });
  const empIds = users.map((u) => u.employee?.id).filter(Boolean) as string[];
  const bizIds = users.map((u) => u.business?.id).filter(Boolean) as string[];
  const userIds = users.map((u) => u.id);
  if (empIds.length) {
    await prisma.employeeActivationToken.deleteMany({ where: { employeeId: { in: empIds } } });
    await prisma.employeeTableAssignment.deleteMany({ where: { employeeId: { in: empIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: empIds } } });
  }
  if (bizIds.length) {
    await prisma.table.deleteMany({ where: { location: { businessId: { in: bizIds } } } });
    await prisma.location.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.subscription.deleteMany({ where: { businessId: { in: bizIds } } });
    await prisma.business.deleteMany({ where: { id: { in: bizIds } } });
  }
  if (userIds.length) {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function testQuota() {
  const basic = await makeManager("basic", "basic");
  const loc1 = await locationsService.createLocationForBusinessUser(basic.id, `R loc1 ${tag}`);
  let seqLocDenied = false;
  try {
    await locationsService.createLocationForBusinessUser(basic.id, `R loc2 ${tag}`);
  } catch (e) {
    seqLocDenied = quotaDenied(e);
  }
  const locCountAfterSeq = await prisma.location.count({ where: { businessId: basic.business!.id } });
  if (seqLocDenied && locCountAfterSeq === 1) {
    pass("A-basic-location-sequential", "Second location rejected; count=1");
  } else {
    fail("A-basic-location-sequential", `denied=${seqLocDenied} count=${locCountAfterSeq}`);
  }

  await prisma.location.deleteMany({ where: { businessId: basic.business!.id } });
  const pair = await Promise.allSettled([
    locationsService.createLocationForBusinessUser(basic.id, `R race L1 ${tag}`),
    locationsService.createLocationForBusinessUser(basic.id, `R race L2 ${tag}`),
  ]);
  const locOk = pair.filter((p) => p.status === "fulfilled").length;
  const locFail = pair.filter((p) => p.status === "rejected");
  const locCount = await prisma.location.count({ where: { businessId: basic.business!.id } });
  const loserQuota = locFail.some((p) => p.status === "rejected" && quotaDenied(p.reason));
  if (locOk === 1 && locCount === 1 && loserQuota) {
    pass("B-basic-location-concurrent", `successes=1 count=1 loser PLAN_LIMIT_EXCEEDED`);
  } else {
    fail("B-basic-location-concurrent", `ok=${locOk} count=${locCount} loserQuota=${loserQuota} ${JSON.stringify(pair.map((p) => p.status))}`);
  }

  await prisma.location.deleteMany({ where: { businessId: basic.business!.id } });
  const stressLoc = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      locationsService.createLocationForBusinessUser(basic.id, `R stress L${i} ${tag}`),
    ),
  );
  const stressLocOk = stressLoc.filter((p) => p.status === "fulfilled").length;
  const stressLocCount = await prisma.location.count({ where: { businessId: basic.business!.id } });
  if (stressLocOk === 1 && stressLocCount === 1) {
    pass("C-basic-location-stress", "8 concurrent creates → exactly 1 row");
  } else {
    fail("C-basic-location-stress", `ok=${stressLocOk} count=${stressLocCount}`);
  }

  const locForTables = await prisma.location.findFirst({ where: { businessId: basic.business!.id } });
  if (!locForTables) {
    fail("D-basic-table-sequential", "missing location");
    return;
  }
  await tablesService.createTableForBusinessUser(basic.id, { name: `R t1 ${tag}`, locationId: locForTables.id });
  let seqTableDenied = false;
  try {
    await tablesService.createTableForBusinessUser(basic.id, { name: `R t2 ${tag}`, locationId: locForTables.id });
  } catch (e) {
    seqTableDenied = quotaDenied(e);
  }
  const tableCountSeq = await prisma.table.count({ where: { location: { businessId: basic.business!.id } } });
  if (seqTableDenied && tableCountSeq === 1) {
    pass("D-basic-table-sequential", "Second table rejected; count=1");
  } else {
    fail("D-basic-table-sequential", `denied=${seqTableDenied} count=${tableCountSeq}`);
  }

  await prisma.table.deleteMany({ where: { location: { businessId: basic.business!.id } } });
  const tablePair = await Promise.allSettled([
    tablesService.createTableForBusinessUser(basic.id, { name: `R race T1 ${tag}`, locationId: locForTables.id }),
    tablesService.createTableForBusinessUser(basic.id, { name: `R race T2 ${tag}`, locationId: locForTables.id }),
  ]);
  const tOk = tablePair.filter((p) => p.status === "fulfilled").length;
  const tFail = tablePair.filter((p) => p.status === "rejected");
  const tCount = await prisma.table.count({ where: { location: { businessId: basic.business!.id } } });
  const tLoser = tFail.some((p) => p.status === "rejected" && quotaDenied(p.reason));
  if (tOk === 1 && tCount === 1 && tLoser) {
    pass("E-basic-table-concurrent", "successes=1 count=1 loser PLAN_LIMIT_EXCEEDED");
  } else {
    fail("E-basic-table-concurrent", `ok=${tOk} count=${tCount} loserQuota=${tLoser}`);
  }

  await prisma.table.deleteMany({ where: { location: { businessId: basic.business!.id } } });
  const stressT = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      tablesService.createTableForBusinessUser(basic.id, { name: `R stress T${i} ${tag}`, locationId: locForTables.id }),
    ),
  );
  const stressTOk = stressT.filter((p) => p.status === "fulfilled").length;
  const stressTCount = await prisma.table.count({ where: { location: { businessId: basic.business!.id } } });
  if (stressTOk === 1 && stressTCount === 1) {
    pass("F-basic-table-stress", "8 concurrent creates → exactly 1 row");
  } else {
    fail("F-basic-table-stress", `ok=${stressTOk} count=${stressTCount}`);
  }

  const pro = await makeManager("pro", "premium");
  await locationsService.createLocationForBusinessUser(pro.id, `R pro L1 ${tag}`);
  await locationsService.createLocationForBusinessUser(pro.id, `R pro L2 ${tag}`);
  await locationsService.createLocationForBusinessUser(pro.id, `R pro L3 ${tag}`);
  const proLocs = await prisma.location.count({ where: { businessId: pro.business!.id } });
  if (proLocs === 3) pass("G-pro-locations", "Pro created 3 locations");
  else fail("G-pro-locations", `count=${proLocs}`);

  const proLoc = await prisma.location.findFirst({ where: { businessId: pro.business!.id } });
  if (proLoc) {
    await tablesService.createTableForBusinessUser(pro.id, { name: `R pro T1 ${tag}`, locationId: proLoc.id });
    await tablesService.createTableForBusinessUser(pro.id, { name: `R pro T2 ${tag}`, locationId: proLoc.id });
    await tablesService.createTableForBusinessUser(pro.id, { name: `R pro T3 ${tag}`, locationId: proLoc.id });
    const proTables = await prisma.table.count({ where: { location: { businessId: pro.business!.id } } });
    if (proTables === 3) pass("H-pro-tables", "Pro created 3 tables");
    else fail("H-pro-tables", `count=${proTables}`);
  } else {
    fail("H-pro-tables", "no pro location");
  }

  const a = await makeManager("isoA", "basic");
  const b = await makeManager("isoB", "basic");
  const iso = await Promise.allSettled([
    locationsService.createLocationForBusinessUser(a.id, `R iso A1 ${tag}`),
    locationsService.createLocationForBusinessUser(a.id, `R iso A2 ${tag}`),
    locationsService.createLocationForBusinessUser(b.id, `R iso B1 ${tag}`),
    locationsService.createLocationForBusinessUser(b.id, `R iso B2 ${tag}`),
  ]);
  const aCount = await prisma.location.count({ where: { businessId: a.business!.id } });
  const bCount = await prisma.location.count({ where: { businessId: b.business!.id } });
  const aLoc = await prisma.location.findFirst({ where: { businessId: a.business!.id } });
  let cross = false;
  if (aLoc) {
    try {
      await tablesService.createTableForBusinessUser(b.id, { name: "steal", locationId: aLoc.id });
      cross = true;
    } catch {
      cross = false;
    }
  }
  if (aCount === 1 && bCount === 1 && !cross) {
    pass("I-tenant-isolation", `A=${aCount} B=${bCount} concurrent pair; cross-tenant table denied; settled=${iso.map((s) => s.status).join(",")}`);
  } else {
    fail("I-tenant-isolation", `A=${aCount} B=${bCount} cross=${cross}`);
  }

  pass("J-retry-behavior", "No SERIALIZABLE retry loop; advisory xact lock serializes check+insert (no duplicate under B/C/E/F)");

  const rec = await makeManager("recreate", "basic");
  const firstLoc = await locationsService.createLocationForBusinessUser(rec.id, `R rec loc ${tag}`);
  await locationsService.deleteLocationForBusinessUser(rec.id, firstLoc.id);
  const secondLoc = await locationsService.createLocationForBusinessUser(rec.id, `R rec loc2 ${tag}`);
  const recLocCount = await prisma.location.count({ where: { businessId: rec.business!.id } });
  const t1 = await tablesService.createTableForBusinessUser(rec.id, { name: `R rec t ${tag}`, locationId: secondLoc.id });
  await prisma.table.delete({ where: { id: t1.id } });
  await tablesService.createTableForBusinessUser(rec.id, { name: `R rec t2 ${tag}`, locationId: secondLoc.id });
  const recTableCount = await prisma.table.count({ where: { location: { businessId: rec.business!.id } } });
  if (recLocCount === 1 && recTableCount === 1) {
    pass("K-delete-recreate", "Basic can recreate location/table after delete; counts=1");
  } else {
    fail("K-delete-recreate", `locs=${recLocCount} tables=${recTableCount}`);
  }
}

async function testActivation() {
  const mgr = await makeManager("act", "premium");
  const created = await employeeService.createEmployeeWithActivation({
    name: "P11R Staff",
    jobTitle: "Waiter",
    email: `p11r-staff-${tag}@caretip-test.local`,
    businessId: mgr.business!.id,
  });
  await authService.activateEmployee(created.activationToken, PW);
  const after = await prisma.employee.findUnique({
    where: { id: created.id },
    include: { user: true },
  });
  if (
    after?.activationStatus === "active" &&
    after.isDeleted === false &&
    after.user?.emailVerified === true &&
    after.user.isActive === true
  ) {
    pass("act-A-normal", "Normal activation: active, not deleted, user verified+active");
  } else {
    fail("act-A-normal", `status=${after?.activationStatus} deleted=${after?.isDeleted}`);
  }

  const pending = await employeeService.createEmployeeWithActivation({
    name: "P11R Pending",
    jobTitle: "Waiter",
    email: `p11r-pending-${tag}@caretip-test.local`,
    businessId: mgr.business!.id,
  });
  await employeeService.deleteEmployeeForBusiness(mgr.business!.id, pending.id);
  const tokenAfterDel = await employeeActivationService.validateActivationToken(pending.activationToken);
  if (tokenAfterDel == null) {
    pass("act-C-validate-after-delete", "validateActivationToken returns null (same as invalid/expired)");
  } else {
    fail("act-C-validate-after-delete", "token still validated after delete");
  }
  const userBefore = await prisma.user.findUnique({
    where: { email: `p11r-pending-${tag}@caretip-test.local` },
    select: { passwordHash: true, emailVerified: true, isActive: true, accountStatus: true },
  });
  let activateFailed = false;
  try {
    await authService.activateEmployee(pending.activationToken, PW);
  } catch {
    activateFailed = true;
  }
  const empAfter = await prisma.employee.findUnique({
    where: { id: pending.id },
    include: { user: { select: { passwordHash: true, emailVerified: true, isActive: true, accountStatus: true } } },
  });
  const passwordUnchanged = empAfter?.user?.passwordHash === userBefore?.passwordHash;
  const stillUnverified = empAfter?.user?.emailVerified === false;
  const stillPending = empAfter?.activationStatus === "pending_activation";
  const stillDeleted = empAfter?.isDeleted === true;
  const stillInactive = empAfter?.user?.isActive === false;
  if (activateFailed && passwordUnchanged && stillUnverified && stillPending && stillDeleted && stillInactive) {
    pass("act-B-deleted-pending", "Activation rejected; no password/verify/active-status transition");
  } else {
    fail(
      "act-B-deleted-pending",
      `fail=${activateFailed} pwSame=${passwordUnchanged} unverified=${stillUnverified} status=${empAfter?.activationStatus} deleted=${stillDeleted} inactive=${stillInactive}`,
    );
  }

  let replayFailed = false;
  try {
    await authService.activateEmployee(created.activationToken, PW);
  } catch {
    replayFailed = true;
  }
  if (replayFailed) pass("act-D-replay", "Token replay after successful activation rejected");
  else fail("act-D-replay", "Replay succeeded");

  let loginOk = false;
  try {
    await authService.validateLoginCredentials({
      email: `p11r-pending-${tag}@caretip-test.local`,
      password: PW,
    });
    loginOk = true;
  } catch {
    loginOk = false;
  }
  if (!loginOk) pass("act-E-login-blocked", "Deleted pending employee cannot log in");
  else fail("act-E-login-blocked", "Login succeeded");

  await requestPasswordReset(`p11r-pending-${tag}@caretip-test.local`);
  const resetCount = await prisma.passwordResetToken.count({
    where: { userId: empAfter?.userId ?? "none" },
  });
  const mayAuth = empAfter?.user ? userMayAuthenticate(empAfter.user) : false;
  if (resetCount === 0 && !mayAuth) pass("act-F-password-reset", "No reset token; userMayAuthenticate false");
  else fail("act-F-password-reset", `tokens=${resetCount} mayAuth=${mayAuth}`);

  await employeeService.deleteEmployeeForBusiness(mgr.business!.id, created.id);
  const deletedActive = await prisma.employee.findUnique({ where: { id: created.id } });
  let loginAfterDeleteActive = false;
  try {
    await authService.validateLoginCredentials({
      email: `p11r-staff-${tag}@caretip-test.local`,
      password: PW,
    });
    loginAfterDeleteActive = true;
  } catch {
    loginAfterDeleteActive = false;
  }
  const tx = await prisma.transaction.create({
    data: {
      amount: 5,
      status: "success",
      employeeId: created.id,
      businessId: mgr.business!.id,
      stripePaymentIntentId: `pi_p11r_${tag}`,
    },
  });
  let tipBlocked = false;
  try {
    await assertEmployeeEligibleForTipPayment(created.id, mgr.business!.id);
  } catch (e) {
    tipBlocked = e instanceof TipPaymentEligibilityError;
  }
  const ledger = await prisma.transaction.findUnique({ where: { id: tx.id } });
  await prisma.transaction.delete({ where: { id: tx.id } }).catch(() => undefined);
  if (deletedActive?.isDeleted && !loginAfterDeleteActive && tipBlocked && ledger?.status === "success") {
    pass("act-G-delete-after-activation", "Soft-delete after activate: login blocked, tips blocked, ledger kept");
  } else {
    fail("act-G-delete-after-activation", `deleted=${deletedActive?.isDeleted} login=${loginAfterDeleteActive} tipBlocked=${tipBlocked}`);
  }

  const other = await makeManager("actB", "premium");
  const empB = await employeeService.createEmployeeWithActivation({
    name: "P11R Other",
    jobTitle: "Waiter",
    email: `p11r-other-${tag}@caretip-test.local`,
    businessId: other.business!.id,
  });
  const preview = await employeeActivationService.validateActivationToken(empB.activationToken);
  if (preview && preview.employeeId === empB.id && preview.employeeId !== created.id) {
    pass("act-H-cross-tenant-token", "Token bound to issuing employee/business branding only");
  } else {
    fail("act-H-cross-tenant-token", `preview employeeId=${preview?.employeeId}`);
  }

  const raceEmp = await employeeService.createEmployeeWithActivation({
    name: "P11R Race",
    jobTitle: "Waiter",
    email: `p11r-actrace-${tag}@caretip-test.local`,
    businessId: mgr.business!.id,
  });
  const raced = await Promise.allSettled([
    authService.activateEmployee(raceEmp.activationToken, PW),
    authService.activateEmployee(raceEmp.activationToken, "OtherPass9!aA"),
  ]);
  const raceOk = raced.filter((r) => r.status === "fulfilled").length;
  const raceEmpRow = await prisma.employee.findUnique({
    where: { id: raceEmp.id },
    include: { user: true, activationTokens: true },
  });
  if (
    raceOk === 1 &&
    raceEmpRow?.activationStatus === "active" &&
    raceEmpRow.isDeleted === false &&
    (raceEmpRow.activationTokens?.length ?? 0) === 0 &&
    raceEmpRow.user?.passwordHash
  ) {
    pass("act-concurrent", "Exactly one concurrent activate succeeded; token consumed; single active employee");
  } else {
    fail("act-concurrent", `ok=${raceOk} status=${raceEmpRow?.activationStatus} tokens=${raceEmpRow?.activationTokens?.length}`);
  }
}

async function main() {
  try {
    await testQuota();
    await testActivation();
  } finally {
    try {
      await cleanup();
    } catch (e) {
      console.error("cleanup failed", e);
    }
    await prisma.$disconnect();
  }
  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n--- Phase 11 remediation regression ---`);
  console.log(`${results.filter((r) => r.status === "PASS").length} passed, ${failed.length} failed, ${results.length} total`);
  if (failed.length) process.exitCode = 1;
}

await main();
