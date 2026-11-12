/**
 * SEC-04 / SEC-05 regression — public guest endpoints vs business status, and public staff list contents.
 *
 * For one approved business with a verified active employee, location and table:
 *   active      → every public endpoint answers normally; tip payment eligibility passes.
 *   suspended   → every public endpoint answers exactly like an UNKNOWN business (same status + body),
 *                 no staff name / photo / status / reason in any body; tip eligibility refuses.
 *   inactive, soft-closed (deletedAt), lifecycle soft_closed → same as suspended.
 *   reactivated → everything works again.
 * The managing owner keeps access to their own staff list while suspended.
 * SEC-05: public staff list has no rating / topRated / tip counts; the owner still gets tip counts.
 *
 * Needs a disposable loopback DB: npm run test:public-business-availability (via safe-test / iso runner).
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import bcrypt from "bcrypt";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("REFUSING: public-business-availability needs a disposable loopback database");
  process.exit(1);
}
process.env.JWT_SECRET ||= "availability-runtime-secret-availability-runtime";
delete process.env.REDIS_URL;

const { prisma } = await import("../src/prisma.js");
const { default: businessRoutes } = await import("../src/routes/business.routes.js");
const { default: employeeRoutes } = await import("../src/routes/employee.routes.js");
const { default: staffRoutes } = await import("../src/routes/staff.routes.js");
const { default: tippingContextRoutes } = await import("../src/routes/tippingContext.routes.js");
const { default: qrScanRoutes } = await import("../src/routes/qrScan.routes.js");
const { default: socketRoutes } = await import("../src/routes/socket.routes.js");
const { assertEmployeeEligibleForTipPayment } = await import("../src/services/tipPaymentEligibility.service.js");
const { issueRefreshToken } = await import("../src/services/refreshToken.service.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");

const app = express();
app.use(express.json());
app.use("/api/business", businessRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/tipping-context", tippingContextRoutes);
app.use("/api/qr", qrScanRoutes);
app.use("/api/socket", socketRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", () => r()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (name: string, fn: () => void) => {
  try {
    fn();
    results.push(`PASS ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${(e as Error).message.split("\n")[0]}`);
  }
};

type Res = { status: number; body: string };
async function call(path: string, init: RequestInit = {}): Promise<Res> {
  const r = await fetch(base + path, {
    ...init,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(init.headers ?? {}) },
  });
  return { status: r.status, body: await r.text() };
}

const tag = Date.now();
const passwordHash = await bcrypt.hash("TestPass1!", 4);
const STAFF_NAME = `Availability Staffer ${tag}`;
const AVATAR = `/uploads/avatars/availability-${tag}.png`;

const mgr = await prisma.user.create({
  data: {
    email: `avail-mgr-${tag}@caretip-test.local`,
    passwordHash,
    role: "MANAGER",
    emailVerified: true,
    hasCompletedOnboarding: true,
    business: {
      create: {
        name: `Availability Venue ${tag}`,
        slug: `avail-venue-${tag}`,
        verificationStatus: "verified",
        onboardingVerificationStatus: "approved",
        subscriptionTier: "premium",
        timezone: "Europe/Berlin",
      },
    },
  },
  include: { business: true },
});
const businessId = mgr.business!.id;
const businessSlug = mgr.business!.slug!;
const empUser = await prisma.user.create({
  data: {
    email: `avail-emp-${tag}@caretip-test.local`,
    passwordHash,
    role: "EMPLOYEE",
    emailVerified: true,
    employee: {
      create: {
        name: STAFF_NAME,
        slug: `avail-staff-${tag}`,
        jobTitle: "Server",
        avatar: AVATAR,
        businessId,
        isActive: true,
        activationStatus: "active",
      },
    },
  },
  include: { employee: true },
});
const employeeId = empUser.employee!.id;
const employeeSlug = empUser.employee!.slug!;
const location = await prisma.location.create({ data: { name: "Availability Hall", businessId } });
const table = await prisma.table.create({
  data: { name: "Availability Table", locationId: location.id, qrSlug: `tbl-avail-${tag}` },
});
await prisma.transaction.create({
  data: { amount: 5, status: "success", employeeId, businessId, stripePaymentIntentId: `pi_avail_${tag}` },
});
const managerToken = (await authResultForUserId(mgr.id, { refreshSessionId: (await issueRefreshToken(mgr.id)).id })).token;

// Unknown identifiers with the same shapes — the reference for "indistinguishable from unknown".
const U = `unknown-${tag}`;
const endpoints = (ids: { biz: string; slug: string; emp: string; empSlug: string; loc: string; tbl: string; qr: string }) => ({
  businessProfile: () => call(`/api/business/${ids.biz}`),
  employeeList: () => call(`/api/employees?businessId=${ids.biz}`),
  employeeDetail: () => call(`/api/employees/${ids.emp}`),
  staffDirectory: () => call(`/api/staff/directory/business/${ids.slug}`),
  staffByBizAndSlug: () => call(`/api/staff/directory/business/${ids.slug}/employee/${ids.empSlug}`),
  staffBySlug: () => call(`/api/staff/${ids.empSlug}`),
  locationContext: () => call(`/api/tipping-context/location/${ids.loc}`),
  tableContext: () => call(`/api/tipping-context/table/${ids.tbl}`),
  tableQrSlug: () => call(`/api/tipping-context/${ids.qr}`),
  socketTokenById: () => call(`/api/socket/public-room-token?businessId=${ids.biz}`),
  socketTokenBySlug: () => call(`/api/socket/public-room-token?businessSlug=${ids.slug}`),
  qrScan: () => call(`/api/qr/scan`, { method: "POST", headers: { "x-caretip-scan-session": `avail-scan-${tag}` }, body: JSON.stringify({ businessId: ids.biz, scanType: "employee", employeeId: ids.emp }) }),
});
const real = endpoints({ biz: businessId, slug: businessSlug, emp: employeeId, empSlug: employeeSlug, loc: location.id, tbl: table.id, qr: table.qrSlug! });
const unknown = endpoints({ biz: U, slug: U, emp: U, empSlug: U, loc: U, tbl: U, qr: `tbl-${U}` });
const names = Object.keys(real) as (keyof typeof real)[];

async function snapshot(eps: typeof real) {
  const out = {} as Record<keyof typeof real, Res>;
  for (const n of names) out[n] = await eps[n]();
  return out;
}

async function tipEligible(): Promise<string> {
  try {
    await assertEmployeeEligibleForTipPayment(employeeId, businessId);
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
}

const PUBLIC_OK_EXPECTED: Partial<Record<keyof typeof real, number>> = { qrScan: 201 };
const scanOk = (s: number) => s === 200 || s === 201;

try {
  const unknownSnap = await snapshot(unknown);

  // ── active ─────────────────────────────────────────────────────────────────
  const active = await snapshot(real);
  for (const n of names) {
    check(`active: ${n} answers normally`, () => {
      if (n === "qrScan") assert.ok(scanOk(active[n].status), `status ${active[n].status} ${active[n].body.slice(0, 120)}`);
      else assert.equal(active[n].status, PUBLIC_OK_EXPECTED[n] ?? 200, active[n].body.slice(0, 160));
    });
  }
  check("active: staff directory lists the employee name + photo", () => {
    assert.ok(active.staffDirectory.body.includes(STAFF_NAME));
    assert.ok(active.staffDirectory.body.includes(`availability-${tag}.png`));
  });
  const activeTip = await tipEligible();
  check("active: tip payment eligibility = ok", () => assert.equal(activeTip, "ok"));

  // ── SEC-05: public staff list contents ────────────────────────────────────
  check("SEC-05: public staff list has no rating / topRated / tip count", () => {
    const list = JSON.parse(active.employeeList.body) as Record<string, unknown>[];
    assert.ok(Array.isArray(list) && list.length === 1, "one employee");
    for (const k of ["rating", "topRated", "tips", "tipCount"]) assert.ok(!(k in list[0]), `public list exposes ${k}`);
    assert.ok(!active.employeeList.body.includes("4.8"), "4.8 rating string present");
  });
  const ownerList = await call(`/api/employees?businessId=${businessId}`, { headers: { authorization: `Bearer ${managerToken}` } });
  check("SEC-05: owning manager still gets tip counts, no rating", () => {
    assert.equal(ownerList.status, 200, ownerList.body.slice(0, 160));
    const list = JSON.parse(ownerList.body) as Record<string, unknown>[];
    assert.equal(list[0].tips, 1);
    assert.ok(!("rating" in list[0]) && !("topRated" in list[0]));
  });

  // ── non-public states ────────────────────────────────────────────────────
  const states: [string, Record<string, unknown>][] = [
    ["suspended", { operationalStatus: "suspended" }],
    ["inactive", { operationalStatus: "inactive" }],
    ["soft-closed (deletedAt)", { deletedAt: new Date() }],
    ["lifecycle soft_closed", { lifecycleStatus: "soft_closed" }],
  ];
  const reset = { operationalStatus: "active", deletedAt: null, lifecycleStatus: "active", tombstonedAt: null } as const;

  for (const [label, data] of states) {
    await prisma.business.update({ where: { id: businessId }, data: { ...reset, ...data } as never });
    const snap = await snapshot(real);
    for (const n of names) {
      check(`${label}: ${n} identical to unknown business`, () => {
        assert.equal(snap[n].status, unknownSnap[n].status, `status ${snap[n].status} vs unknown ${unknownSnap[n].status}`);
        assert.equal(snap[n].body, unknownSnap[n].body, `body differs: ${snap[n].body.slice(0, 120)}`);
      });
    }
    check(`${label}: no staff name, photo, status or reason in any public body`, () => {
      for (const n of names) {
        const b = snap[n].body.toLowerCase();
        assert.ok(!snap[n].body.includes(STAFF_NAME), `${n} leaks staff name`);
        assert.ok(!b.includes(`availability-${tag}.png`), `${n} leaks photo`);
        for (const w of ["suspend", "inactive", "closed", "deleted", "lifecycle"]) assert.ok(!b.includes(w), `${n} leaks "${w}"`);
      }
    });
    const tip = await tipEligible();
    check(`${label}: tip payment eligibility refused`, () => assert.notEqual(tip, "ok"));
    if (label === "suspended") {
      const own = await call(`/api/employees?businessId=${businessId}`, { headers: { authorization: `Bearer ${managerToken}` } });
      check("suspended: owning manager still sees their own staff list", () => {
        assert.equal(own.status, 200, own.body.slice(0, 160));
        assert.ok(own.body.includes(STAFF_NAME));
      });
    }
  }

  // ── reactivated ──────────────────────────────────────────────────────────
  await prisma.business.update({ where: { id: businessId }, data: reset as never });
  const again = await snapshot(real);
  for (const n of names) {
    check(`reactivated: ${n} answers normally`, () => {
      if (n === "qrScan") assert.ok(scanOk(again[n].status), `status ${again[n].status}`);
      else assert.equal(again[n].status, active[n].status, again[n].body.slice(0, 160));
    });
  }
  const tipAgain = await tipEligible();
  check("reactivated: tip payment eligibility = ok", () => assert.equal(tipAgain, "ok"));
} finally {
  await prisma.qrGuestVisit.deleteMany({ where: { businessId } }).catch(() => undefined);
  await prisma.qrScanEvent.deleteMany({ where: { businessId } }).catch(() => undefined);
  await prisma.businessActivityEvent.deleteMany({ where: { businessId } }).catch(() => undefined);
  await prisma.notification.deleteMany({ where: { userId: mgr.id } }).catch(() => undefined);
  await prisma.transaction.deleteMany({ where: { businessId } }).catch(() => undefined);
  await prisma.table.delete({ where: { id: table.id } }).catch(() => undefined);
  await prisma.location.delete({ where: { id: location.id } }).catch(() => undefined);
  await prisma.refreshToken.deleteMany({ where: { userId: mgr.id } }).catch(() => undefined);
  await prisma.employee.delete({ where: { id: employeeId } }).catch(() => undefined);
  await prisma.business.delete({ where: { id: businessId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: { in: [mgr.id, empUser.id] } } }).catch(() => undefined);
  server.close();
  await prisma.$disconnect();
}

for (const r of results) console.log(r);
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
