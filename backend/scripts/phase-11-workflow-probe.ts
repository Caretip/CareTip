/**
 * Phase 11 — local business-logic probes (assessment only; does not change app behavior).
 * Disposable @caretip-test.local fixtures. Run from backend:
 *   dotenv -e ../.env -e .env -- tsx scripts/phase-11-workflow-probe.ts
 */
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import * as employeeService from "../src/services/employee.service.js";
import * as employeeActivationService from "../src/services/employeeActivation.service.js";
import * as locationsService from "../src/services/locations.service.js";
import * as tablesService from "../src/services/tables.service.js";
import * as authService from "../src/services/auth.service.js";
import { provisionInternalBasicSubscription } from "../src/services/subscription.service.js";
import { isEntitlementDeniedError } from "../src/lib/subscription/entitlementHttpError.js";
import { userMayAuthenticate } from "../src/services/accountAccess.service.js";
import { requestPasswordReset } from "../src/services/passwordReset.service.js";
import { resolvePhysicalQrContext, PhysicalQrContextError } from "../src/services/physicalQr/qrContext.service.js";
import { markNotificationRead } from "../src/services/notifications/notificationInbox.service.js";

type Status = "PASS" | "FAIL" | "CONFIRMED" | "INFO";
const results: { id: string; status: Status; detail: string }[] = [];

function rec(id: string, status: Status, detail: string) {
  results.push({ id, status, detail });
  console.log(`${status}: ${id} — ${detail}`);
}

const tag = Date.now();
const PW = "TestPass1!aA";

async function makeManager(suffix: string, tier: "basic" | "premium" = "premium") {
  const passwordHash = await bcrypt.hash(PW, 10);
  const user = await prisma.user.create({
    data: {
      email: `p11-${suffix}-${tag}@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `P11 ${suffix} ${tag}`,
          slug: `p11-${suffix}-${tag}`,
          verificationStatus: "verified",
          subscriptionTier: tier,
        },
      },
    },
    include: { business: true },
  });
  return user;
}

async function cleanupEmails() {
  const users = await prisma.user.findMany({
    where: { email: { contains: `${tag}@caretip-test.local` } },
    select: { id: true, email: true, role: true, business: { select: { id: true } }, employee: { select: { id: true } } },
  });
  const empIds = users.map((u) => u.employee?.id).filter(Boolean) as string[];
  const bizIds = users.map((u) => u.business?.id).filter(Boolean) as string[];
  const userIds = users.map((u) => u.id);

  if (empIds.length) {
    await prisma.employeeActivationToken.deleteMany({ where: { employeeId: { in: empIds } } });
    await prisma.employeeTableAssignment.deleteMany({ where: { employeeId: { in: empIds } } });
  }
  const orphanEmps = await prisma.employee.findMany({
    where: { name: { startsWith: `P11 orphan ${tag}` } },
    select: { id: true, businessId: true },
  });
  const allEmp = [...empIds, ...orphanEmps.map((e) => e.id)];
  if (allEmp.length) {
    await prisma.employeeActivationToken.deleteMany({ where: { employeeId: { in: allEmp } } });
    await prisma.employeeTableAssignment.deleteMany({ where: { employeeId: { in: allEmp } } });
    await prisma.employee.deleteMany({ where: { id: { in: allEmp } } });
  }

  const extraBiz = [...bizIds, ...orphanEmps.map((e) => e.businessId)];
  if (extraBiz.length) {
    await prisma.table.deleteMany({ where: { location: { businessId: { in: extraBiz } } } });
    await prisma.location.deleteMany({ where: { businessId: { in: extraBiz } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.subscription.deleteMany({ where: { businessId: { in: extraBiz } } }).catch(() => undefined);
    await prisma.business.deleteMany({ where: { id: { in: extraBiz } } });
  }
  if (userIds.length) {
    await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function probeActivationAfterDelete() {
  const mgr = await makeManager("actdel", "premium");
  const bizId = mgr.business!.id;
  const created = await employeeService.createEmployeeWithActivation({
    name: "P11 Pending",
    jobTitle: "Waiter",
    email: `p11-pending-${tag}@caretip-test.local`,
    businessId: bizId,
  });

  await employeeService.deleteEmployeeForBusiness(bizId, created.id);

  const empAfterDel = await prisma.employee.findUnique({
    where: { id: created.id },
    include: { user: { select: { id: true, isActive: true, accountStatus: true, passwordHash: true, emailVerified: true } } },
  });
  const tokenStillValid = await employeeActivationService.validateActivationToken(created.activationToken);

  let activateOk = false;
  let activateErr = "";
  try {
    await authService.activateEmployee(created.activationToken, PW);
    activateOk = true;
  } catch (e) {
    activateErr = e instanceof Error ? e.message : String(e);
  }

  const empAfterAct = await prisma.employee.findUnique({
    where: { id: created.id },
    include: { user: { select: { id: true, isActive: true, accountStatus: true, passwordHash: true, emailVerified: true } } },
  });

  rec(
    "activation-token-survives-delete",
    tokenStillValid ? "CONFIRMED" : "PASS",
    tokenStillValid
      ? "validateActivationToken still returns employee after soft-delete (tokens not revoked)"
      : "Activation token invalidated on delete",
  );

  rec(
    "activate-after-delete",
    activateOk ? "CONFIRMED" : "PASS",
    activateOk
      ? `activateEmployee succeeded after delete; employee isDeleted=${empAfterAct?.isDeleted} activationStatus=${empAfterAct?.activationStatus} user.isActive=${empAfterAct?.user?.isActive}`
      : `activateEmployee rejected after delete: ${activateErr}`,
  );

  let loginOk = false;
  try {
    await authService.validateLoginCredentials({
      email: `p11-pending-${tag}@caretip-test.local`,
      password: PW,
    });
    loginOk = true;
  } catch {
    loginOk = false;
  }
  rec(
    "login-after-deleted-activation",
    loginOk ? "CONFIRMED" : "PASS",
    loginOk
      ? "Deleted pending employee can log in after completing leftover activation token"
      : "Login blocked after deleted-employee activation (user.isActive/accountStatus gate)",
  );

  const mayAuth = empAfterAct?.user ? userMayAuthenticate(empAfterAct.user) : false;
  rec(
    "password-reset-gate-deleted",
    mayAuth ? "CONFIRMED" : "PASS",
    mayAuth ? "userMayAuthenticate true after deleted activation" : "Password reset / auth gate closed for revoked user",
  );

  await requestPasswordReset(`p11-pending-${tag}@caretip-test.local`);
  const resetRows = await prisma.passwordResetToken.count({
    where: { userId: empAfterAct?.user?.id ?? "none" },
  });
  rec(
    "password-reset-no-token-inactive",
    resetRows === 0 ? "PASS" : "CONFIRMED",
    resetRows === 0
      ? "requestPasswordReset issued no token for inactive deleted-activation user"
      : `Unexpected password reset token count=${resetRows}`,
  );

  let replayErr = "";
  try {
    await authService.activateEmployee(created.activationToken, PW);
    rec("activation-replay", "CONFIRMED", "Second activateEmployee succeeded (token reusable)");
  } catch (e) {
    replayErr = e instanceof Error ? e.message : String(e);
    rec("activation-replay", "PASS", `Replay rejected: ${replayErr}`);
  }

  rec(
    "deleted-employee-mutation",
    "INFO",
    `pre-activate after delete: isDeleted=${empAfterDel?.isDeleted} activationStatus=${empAfterDel?.activationStatus} user.isActive=${empAfterDel?.user?.isActive}`,
  );
}

async function probeLegacyOrphanActivation() {
  const mgr = await makeManager("orphan", "premium");
  const bizId = mgr.business!.id;
  const emp = await prisma.employee.create({
    data: {
      name: `P11 orphan ${tag}`,
      jobTitle: "Waiter",
      businessId: bizId,
      userId: null,
      isActive: true,
      activationStatus: "pending_activation",
    },
  });
  const token = await employeeActivationService.createEmployeeActivationToken(
    emp.id,
    `p11-orphan-${tag}@caretip-test.local`,
    24,
  );
  await employeeService.deleteEmployeeForBusiness(bizId, emp.id);

  let activateOk = false;
  try {
    await authService.activateEmployee(token, PW);
    activateOk = true;
  } catch (e) {
    rec(
      "legacy-orphan-activate-after-delete",
      "PASS",
      `Orphan activate after delete rejected: ${e instanceof Error ? e.message : e}`,
    );
    return;
  }

  const row = await prisma.employee.findUnique({
    where: { id: emp.id },
    include: { user: { select: { id: true, isActive: true, accountStatus: true, email: true } } },
  });
  let loginOk = false;
  try {
    await authService.validateLoginCredentials({
      email: `p11-orphan-${tag}@caretip-test.local`,
      password: PW,
    });
    loginOk = true;
  } catch {
    loginOk = false;
  }

  rec(
    "legacy-orphan-activate-after-delete",
    activateOk && loginOk ? "CONFIRMED" : activateOk ? "INFO" : "PASS",
    `activateOk=${activateOk} loginOk=${loginOk} isDeleted=${row?.isDeleted} activationStatus=${row?.activationStatus} user.isActive=${row?.user?.isActive} (requires leftover userId-null employee + stolen token; current invite API always creates a User)`,
  );
}

async function probeQuotaRace() {
  const mgr = await makeManager("quota", "basic");
  const userId = mgr.id;
  const bizId = mgr.business!.id;
  await provisionInternalBasicSubscription(bizId);

  const sequential1 = await locationsService.createLocationForBusinessUser(userId, `P11 loc A ${tag}`);
  let sequentialDenied = false;
  try {
    await locationsService.createLocationForBusinessUser(userId, `P11 loc B sequential ${tag}`);
  } catch (e) {
    sequentialDenied = isEntitlementDeniedError(e) || (e instanceof Error && /limit|entitlement|403/i.test(e.message));
  }
  rec(
    "basic-location-sequential",
    sequentialDenied ? "PASS" : "CONFIRMED",
    sequentialDenied
      ? "Second sequential Basic location create denied"
      : "Second sequential Basic location create succeeded (quota not enforced)",
  );

  await prisma.location.deleteMany({ where: { businessId: bizId } });

  const raced = await Promise.allSettled([
    locationsService.createLocationForBusinessUser(userId, `P11 race L1 ${tag}`),
    locationsService.createLocationForBusinessUser(userId, `P11 race L2 ${tag}`),
  ]);
  const locCount = await prisma.location.count({ where: { businessId: bizId } });
  rec(
    "basic-location-race",
    locCount > 1 ? "CONFIRMED" : "PASS",
    `Concurrent location creates: settled=${raced.map((r) => r.status).join(",")} count=${locCount} (Basic max=1)`,
  );

  const loc =
    locCount > 0
      ? await prisma.location.findFirst({ where: { businessId: bizId } })
      : sequential1;
  if (!loc) {
    rec("basic-table-race", "INFO", "No location to attach tables");
    return;
  }

  await prisma.table.deleteMany({ where: { location: { businessId: bizId } } });
  const tableRace = await Promise.allSettled([
    tablesService.createTableForBusinessUser(userId, { name: `P11 T1 ${tag}`, locationId: loc.id }),
    tablesService.createTableForBusinessUser(userId, { name: `P11 T2 ${tag}`, locationId: loc.id }),
  ]);
  const tableCount = await prisma.table.count({ where: { location: { businessId: bizId } } });
  rec(
    "basic-table-race",
    tableCount > 1 ? "CONFIRMED" : "PASS",
    `Concurrent table creates: settled=${tableRace.map((r) => r.status).join(",")} count=${tableCount} (Basic max=1)`,
  );
}

async function probeCrossTenantAndDeletedRefs() {
  const a = await makeManager("tenA", "premium");
  const b = await makeManager("tenB", "premium");
  await provisionInternalBasicSubscription(a.business!.id);
  await provisionInternalBasicSubscription(b.business!.id);
  const locA = await locationsService.createLocationForBusinessUser(a.id, `P11 A loc ${tag}`);
  let tableCross = false;
  try {
    await tablesService.createTableForBusinessUser(b.id, { name: `P11 steal ${tag}`, locationId: locA.id });
    tableCross = true;
  } catch {
    tableCross = false;
  }
  rec(
    "table-cross-tenant-location",
    tableCross ? "CONFIRMED" : "PASS",
    tableCross ? "Business B created a table on A's location" : "Table create rejects another tenant's locationId",
  );

  const empA = await employeeService.createEmployeeWithActivation({
    name: "P11 Staff A",
    jobTitle: "Waiter",
    email: `p11-staffa-${tag}@caretip-test.local`,
    businessId: a.business!.id,
  });
  await employeeService.deleteEmployeeForBusiness(a.business!.id, empA.id);
  try {
    await resolvePhysicalQrContext({
      businessId: a.business!.id,
      qrContextType: "employee",
      qrSubjectId: empA.id,
    });
    rec("qr-deleted-employee", "CONFIRMED", "Physical QR context accepted deleted employee id");
  } catch (e) {
    const code = e instanceof PhysicalQrContextError ? e.code : "ERR";
    rec("qr-deleted-employee", "PASS", `Deleted employee QR context rejected (${code})`);
  }

  try {
    await resolvePhysicalQrContext({
      businessId: b.business!.id,
      qrContextType: "location",
      qrSubjectId: locA.id,
    });
    rec("qr-cross-tenant-location", "CONFIRMED", "Business B resolved QR for A's location");
  } catch (e) {
    const code = e instanceof PhysicalQrContextError ? e.code : "ERR";
    rec("qr-cross-tenant-location", "PASS", `Cross-tenant location QR rejected (${code})`);
  }

  try {
    await employeeService.updateEmployeeForBusiness(a.business!.id, empA.id, { name: "Hacked" });
    rec("mutate-deleted-employee", "CONFIRMED", "Manager updated a soft-deleted employee");
  } catch {
    rec("mutate-deleted-employee", "PASS", "updateEmployeeForBusiness ignores isDeleted employees");
  }
}

async function probeNotifications() {
  const mgr = await makeManager("notif", "premium");
  const other = await makeManager("notif2", "premium");
  const n = await prisma.notification.create({
    data: {
      userId: mgr.id,
      type: "system",
      title: "P11",
      message: "probe",
    },
  });
  const stolen = await markNotificationRead(other.id, n.id);
  rec(
    "notification-cross-user-read",
    stolen ? "CONFIRMED" : "PASS",
    stolen ? "User B marked User A's notification read" : "markNotificationRead scoped to recipient userId",
  );
  const own = await markNotificationRead(mgr.id, n.id);
  const again = await markNotificationRead(mgr.id, n.id);
  rec(
    "notification-read-idempotent",
    own && again ? "PASS" : "INFO",
    `First read dto=${Boolean(own)} second read dto=${Boolean(again)} (repeat read is idempotent, not a vuln)`,
  );
}

async function probeConcurrentActivation() {
  const mgr = await makeManager("actrace", "premium");
  const created = await employeeService.createEmployeeWithActivation({
    name: "P11 Race Act",
    jobTitle: "Waiter",
    email: `p11-actrace-emp-${tag}@caretip-test.local`,
    businessId: mgr.business!.id,
  });
  const raced = await Promise.allSettled([
    authService.activateEmployee(created.activationToken, PW),
    authService.activateEmployee(created.activationToken, "OtherPass1!aA"),
  ]);
  const fulfilled = raced.filter((r) => r.status === "fulfilled").length;
  const user = await prisma.user.findUnique({
    where: { email: `p11-actrace-emp-${tag}@caretip-test.local` },
    select: { passwordHash: true },
  });
  rec(
    "concurrent-activation",
    fulfilled > 1 ? "INFO" : "PASS",
    `Concurrent activateEmployee fulfilled=${fulfilled} rejected=${2 - fulfilled}; single user row remains (hash present=${Boolean(user?.passwordHash)})`,
  );
}

async function main() {
  try {
    await probeActivationAfterDelete();
    await probeLegacyOrphanActivation();
    await probeQuotaRace();
    await probeCrossTenantAndDeletedRefs();
    await probeNotifications();
    await probeConcurrentActivation();
  } finally {
    try {
      await cleanupEmails();
    } catch (e) {
      console.error("cleanup failed", e);
    }
    await prisma.$disconnect();
  }

  const confirmed = results.filter((r) => r.status === "CONFIRMED");
  const failed = results.filter((r) => r.status === "FAIL");
  console.log("\n--- Phase 11 probe summary ---");
  console.log(`CONFIRMED ${confirmed.length} / PASS+INFO ${results.length - confirmed.length - failed.length} / FAIL ${failed.length}`);
  if (failed.length) process.exitCode = 1;
}

await main();
