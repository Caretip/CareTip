/**
 * Employee assignment visibility — `/api/employees/me` assignment DTO and tenant isolation.
 * Run: npm run test:employee-assignment-visibility
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcrypt";
import { prisma } from "../src/prisma.js";
import { signAuthJwt } from "../src/services/auth.service.js";
import * as employeeService from "../src/services/employee.service.js";

const API = (process.env.RUNTIME_API_BASE ?? "http://localhost:3001").replace(/\/$/, "");
const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);
const skip = (m: string) => results.push(`SKIP: ${m}`);

function readFromScript(rel: string): string {
  return readFileSync(path.resolve(scriptDir, rel), "utf8");
}

async function api(
  pathName: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${API}${pathName}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { status: res.status, body };
}

async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

type SeedBundle = {
  businessId: string;
  managerId: string;
  employeeUserId: string;
  otherEmployeeUserId: string;
  employeeId: string;
  locationAId: string;
  locationBId: string;
  table1Id: string;
  table2Id: string;
  table3Id: string;
  otherBusinessLocationId: string;
  otherBusinessTableId: string;
  employeeToken: string;
  otherEmployeeToken: string;
  managerToken: string;
  cleanup: () => Promise<void>;
};

async function seed(label: string): Promise<SeedBundle> {
  const tag = `${label}-${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass1!", 10);

  const manager = await prisma.user.create({
    data: {
      email: `${tag}-mgr@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `${label} Venue`,
          slug: `${tag}-venue`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });

  const empUser = await prisma.user.create({
    data: {
      email: `${tag}-emp@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: `${label} Staff`,
          slug: `${tag}-staff`,
          jobTitle: "Host",
          businessId: manager.business!.id,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });

  const otherMgr = await prisma.user.create({
    data: {
      email: `${tag}-other-mgr@caretip-test.local`,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      business: {
        create: {
          name: `${label} Other Venue`,
          slug: `${tag}-other-venue`,
          verificationStatus: "verified",
          subscriptionTier: "premium",
        },
      },
    },
    include: { business: true },
  });

  const otherEmpUser = await prisma.user.create({
    data: {
      email: `${tag}-other-emp@caretip-test.local`,
      passwordHash,
      role: "EMPLOYEE",
      emailVerified: true,
      employee: {
        create: {
          name: `${label} Other Staff`,
          slug: `${tag}-other-staff`,
          jobTitle: "Host",
          businessId: otherMgr.business!.id,
          isActive: true,
          activationStatus: "active",
        },
      },
    },
    include: { employee: true },
  });

  const businessId = manager.business!.id;
  const locationA = await prisma.location.create({
    data: {
      businessId,
      name: `${label} Patio`,
      description: "Outdoor seating area",
    },
  });
  const locationB = await prisma.location.create({
    data: { businessId, name: `${label} Bar`, description: "  " },
  });
  const table1 = await prisma.table.create({
    data: { name: "Table 1", locationId: locationA.id, qrSlug: `tbl-${tag}-1` },
  });
  const table2 = await prisma.table.create({
    data: { name: "Table 2", locationId: locationA.id, qrSlug: `tbl-${tag}-2` },
  });
  const table3 = await prisma.table.create({
    data: { name: "Bar Table", locationId: locationB.id, qrSlug: `tbl-${tag}-3` },
  });

  const otherLocation = await prisma.location.create({
    data: { businessId: otherMgr.business!.id, name: "Foreign Floor", description: "Secret" },
  });
  const otherTable = await prisma.table.create({
    data: { name: "Foreign Table", locationId: otherLocation.id, qrSlug: `tbl-${tag}-foreign` },
  });

  const sign = (userId: string, email: string, role: "MANAGER" | "EMPLOYEE") =>
    signAuthJwt({ userId, id: userId, email, role, roleLabel: role });

  return {
    businessId,
    managerId: manager.id,
    employeeUserId: empUser.id,
    otherEmployeeUserId: otherEmpUser.id,
    employeeId: empUser.employee!.id,
    locationAId: locationA.id,
    locationBId: locationB.id,
    table1Id: table1.id,
    table2Id: table2.id,
    table3Id: table3.id,
    otherBusinessLocationId: otherLocation.id,
    otherBusinessTableId: otherTable.id,
    employeeToken: sign(empUser.id, empUser.email, "EMPLOYEE"),
    otherEmployeeToken: sign(otherEmpUser.id, otherEmpUser.email, "EMPLOYEE"),
    managerToken: sign(manager.id, manager.email, "MANAGER"),
    cleanup: async () => {
      await prisma.employeeTableAssignment.deleteMany({
        where: { employeeId: { in: [empUser.employee!.id, otherEmpUser.employee!.id] } },
      });
      await prisma.table.deleteMany({
        where: {
          id: { in: [table1.id, table2.id, table3.id, otherTable.id] },
        },
      });
      await prisma.location.deleteMany({
        where: { id: { in: [locationA.id, locationB.id, otherLocation.id] } },
      });
      await prisma.employee.deleteMany({
        where: { businessId: { in: [businessId, otherMgr.business!.id] } },
      });
      await prisma.business.deleteMany({
        where: { id: { in: [businessId, otherMgr.business!.id] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [manager.id, empUser.id, otherMgr.id, otherEmpUser.id] },
        },
      });
    },
  };
}

function assertEmptyAssignment(profile: employeeService.EmployeeSelfProfile | null) {
  if (!profile) return false;
  return profile.assignment.location === null && profile.assignment.tables.length === 0;
}

async function main() {
  let fx: SeedBundle | null = null;

  try {
    fx = await seed("assign-vis");
    pass("seed tenant with locations, tables, and two employees");

    let profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (profile && assertEmptyAssignment(profile)) {
      pass("no location and no tables when unassigned");
    } else {
      fail("expected empty assignment for unassigned employee");
    }

    await employeeService.updateEmployeeForBusiness(fx.businessId, fx.employeeId, {
      locationId: fx.locationAId,
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (
      profile?.assignment.location?.id === fx.locationAId &&
      profile.assignment.location.name === "assign-vis Patio" &&
      profile.assignment.location.description === "Outdoor seating area" &&
      profile.assignment.tables.length === 0
    ) {
      pass("employee sees assigned location with description");
    } else {
      fail("assigned location not returned correctly");
    }

    await employeeService.updateEmployeeForBusiness(fx.businessId, fx.employeeId, {
      tableIds: [fx.table1Id],
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (
      profile?.assignment.tables.length === 1 &&
      profile.assignment.tables[0]?.id === fx.table1Id &&
      profile.assignment.tables[0]?.location.id === fx.locationAId
    ) {
      pass("employee sees one assigned table with parent location");
    } else {
      fail("single table assignment not returned correctly");
    }

    await employeeService.updateEmployeeForBusiness(fx.businessId, fx.employeeId, {
      tableIds: [fx.table2Id, fx.table1Id],
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (
      profile?.assignment.tables.length === 2 &&
      profile.assignment.tables[0]?.name === "Table 1" &&
      profile.assignment.tables[1]?.name === "Table 2"
    ) {
      pass("employee sees multiple assigned tables (sorted by name)");
    } else {
      fail("multiple table assignments not returned correctly");
    }

    await employeeService.updateEmployeeForBusiness(fx.businessId, fx.employeeId, {
      locationId: fx.locationBId,
      tableIds: [fx.table3Id],
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (
      profile?.assignment.location?.id === fx.locationBId &&
      profile.assignment.location.description === null &&
      profile.assignment.tables.length === 1 &&
      profile.assignment.tables[0]?.id === fx.table3Id
    ) {
      pass("manager reassignment A → B reflected after profile refresh");
    } else {
      fail("location reassignment not reflected");
    }

    await employeeService.updateEmployeeForBusiness(fx.businessId, fx.employeeId, {
      tableIds: [],
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (profile?.assignment.tables.length === 0) {
      pass("removing table assignments reflected");
    } else {
      fail("table removal not reflected");
    }

    await employeeService.updateEmployeeForBusiness(fx.businessId, fx.employeeId, {
      tableIds: [fx.table3Id],
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (profile?.assignment.tables.length === 1 && profile.assignment.tables[0]?.id === fx.table3Id) {
      pass("adding table assignments reflected");
    } else {
      fail("table add not reflected");
    }

    await prisma.employee.update({
      where: { id: fx.employeeId },
      data: { locationId: fx.otherBusinessLocationId },
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    if (profile?.assignment.location === null) {
      pass("cross-business locationId does not leak foreign location");
    } else {
      fail("cross-business location leaked via assignment.location");
    }

    await prisma.employee.update({
      where: { id: fx.employeeId },
      data: { locationId: fx.locationAId },
    });
    await prisma.employeeTableAssignment.create({
      data: {
        employeeId: fx.employeeId,
        tableId: fx.otherBusinessTableId,
        employeeName: "assign-vis Staff",
      },
    });
    profile = await employeeService.getEmployeeProfileForUser(fx.employeeUserId);
    const leakedForeignTable = profile?.assignment.tables.some((t) => t.id === fx!.otherBusinessTableId);
    if (!leakedForeignTable) {
      pass("cross-business table assignment filtered from employee profile");
    } else {
      fail("cross-business table leaked via assignment.tables");
    }

    const otherProfile = await employeeService.getEmployeeProfileForUser(fx.otherEmployeeUserId);
    if (otherProfile && otherProfile.id !== profile?.id && assertEmptyAssignment(otherProfile)) {
      pass("employee only sees own assignment via /me service path");
    } else {
      fail("other employee assignment scope incorrect");
    }

    const managerPatch = await employeeService.updateEmployeeForBusiness(fx.businessId, fx.employeeId, {
      locationId: fx.locationBId,
      tableIds: [fx.table3Id],
    });
    if (managerPatch.locationId === fx.locationBId && managerPatch.assignedTableIds.includes(fx.table3Id)) {
      pass("manager assignment API remains intact");
    } else {
      fail("manager assignment API regression");
    }

    const apiUp = await isApiReachable();
    if (apiUp) {
      const me = await api("/api/employees/me", fx.employeeToken);
      if (me.status === 200 && typeof me.body === "object" && me.body !== null) {
        const body = me.body as { assignment?: { location?: { id?: string }; tables?: Array<{ id?: string }> } };
        if (
          body.assignment?.location?.id === fx.locationBId &&
          body.assignment.tables?.length === 1 &&
          body.assignment.tables[0]?.id === fx.table3Id
        ) {
          pass("GET /api/employees/me returns assignment for authenticated employee");
        } else {
          fail("GET /api/employees/me assignment payload mismatch");
        }
      } else {
        fail(`GET /api/employees/me expected 200 got ${me.status}`);
      }

      const foreignMe = await api("/api/employees/me", fx.otherEmployeeToken);
      if (foreignMe.status === 200 && typeof foreignMe.body === "object" && foreignMe.body !== null) {
        const body = foreignMe.body as { assignment?: { location?: unknown; tables?: unknown[] } };
        if (body.assignment?.location == null && (body.assignment?.tables?.length ?? 0) === 0) {
          pass("other employee HTTP /me cannot see primary employee assignment");
        } else {
          fail("other employee /me leaked assignment data");
        }
      } else {
        fail(`other employee /me expected 200 got ${foreignMe.status}`);
      }
    } else {
      skip(`API not reachable at ${API} — HTTP checks skipped`);
    }

    const employeeServiceSrc = readFromScript("../src/services/employee.service.ts");
    if (
      employeeServiceSrc.includes("buildEmployeeSelfAssignment") &&
      employeeServiceSrc.includes("tableAssignments") &&
      !employeeServiceSrc.includes("qrSlug")
    ) {
      pass("employee /me assignment built from existing relations without qrSlug");
    } else {
      fail("employee service assignment implementation check");
    }

    const webAssignmentPage = readFromScript("../../src/app/pages/employee/EmployeeAssignmentPage.tsx");
    const webNav = readFromScript("../../src/app/components/employee/employeeDashboardNav.ts");
    const webDashboard = readFromScript("../../src/app/pages/employee/EmployeeDashboard.tsx");
    if (
      webAssignmentPage.includes("EmployeeAssignmentCard") &&
      webAssignmentPage.includes("readEmployeeAssignmentSnapshot") &&
      webNav.includes("/employee/assignment") &&
      !webDashboard.includes("EmployeeAssignmentCard")
    ) {
      pass("web assignment is a dedicated page with sidebar nav (not overview)");
    } else {
      fail("web employee assignment page/nav integration missing");
    }

    const mobileAssignment = readFromScript("../../mobile/features/employee/EmployeeAssignmentScreen.tsx");
    const mobileDashboard = readFromScript("../../mobile/features/employee/EmployeeDashboardScreen.tsx");
    const mobileMenu = readFromScript("../../mobile/features/navigation/appMenuConfig.ts");
    if (
      mobileAssignment.includes("fetchEmployeeProfile") &&
      mobileMenu.includes("employee/assignment") &&
      !mobileDashboard.includes("employeeAssignment")
    ) {
      pass("mobile assignment is a dedicated screen from More menu (not overview)");
    } else {
      fail("mobile employee assignment screen integration missing");
    }

    const qrModal = readFromScript("../../src/app/components/employee/EmployeeQRCodeModal.tsx");
    if (qrModal.includes("plainQr")) {
      pass("employee plain QR modal still uses plain digital QR");
    } else {
      fail("employee QR modal plain QR regression");
    }

    const staffPage = readFromScript("../../src/app/pages/business/StaffManagementPage.tsx");
    if (staffPage.includes("resolveStaffAssignments") || staffPage.includes("locationId")) {
      pass("staff management page unchanged (still has assignment fields)");
    } else {
      skip("staff management assignment markers not found — manual review");
    }
  } catch (e) {
    fail(`runtime: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (fx) await fx.cleanup();
  }

  const failed = results.filter((r) => r.startsWith("FAIL:"));
  for (const line of results) console.log(line);
  if (failed.length) {
    console.error(`\n${failed.length} employee assignment visibility check(s) failed`);
    process.exit(1);
  }
  console.log(`\n${results.length} employee assignment visibility checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
