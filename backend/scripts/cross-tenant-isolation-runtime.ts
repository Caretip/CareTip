/**
 * Tenant isolation and role boundaries over real routes. Each object is requested by its owner first,
 * so a 403 from a subscription gate cannot pass as tenant protection. Needs a disposable loopback DB.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import bcrypt from "bcrypt";

if (!/@(127\.0\.0\.1|localhost)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("REFUSING: cross-tenant-isolation needs a disposable loopback database");
  process.exit(1);
}
process.env.JWT_SECRET ||= "isolation-runtime-secret-isolation-runtime";
delete process.env.REDIS_URL;

const { prisma } = await import("../src/prisma.js");
const { default: employeeRoutes } = await import("../src/routes/employee.routes.js");
const { default: locationsRoutes } = await import("../src/routes/locations.routes.js");
const { default: goalsRoutes } = await import("../src/routes/goals.routes.js");
const { default: notificationsRoutes } = await import("../src/routes/notifications.routes.js");
const { default: connectRoutes } = await import("../src/routes/connect.routes.js");
const { default: supportRoutes } = await import("../src/routes/supportTicket.routes.js");
const { default: physicalQrRoutes } = await import("../src/routes/physicalQr.routes.js");
const { default: platformRoutes } = await import("../src/routes/platform.routes.js");
const { issueRefreshToken } = await import("../src/services/refreshToken.service.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");

const app = express();
app.use(express.json());
app.use("/api/me/notifications", notificationsRoutes);
app.use("/api/me", connectRoutes);
app.use("/api/business/physical-qr", physicalQrRoutes);
app.use("/api/business/support", supportRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/goals", goalsRoutes);
app.use("/api/locations", locationsRoutes);
app.use("/api/platform", platformRoutes);
app.use("/api/admin", platformRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const rnd = () => Math.random().toString(36).slice(2, 10);
const HASH = await bcrypt.hash("Runtime-Synthetic-Pw-9!x", 4);

async function call(method: string, path: string, token: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.status;
}
const tokenFor = async (id: string) => (await authResultForUserId(id, { refreshSessionId: (await issueRefreshToken(id)).id })).token;

async function tenant(tag: string) {
  const m = await prisma.user.create({
    data: {
      email: `mgr-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "MANAGER", emailVerified: true, hasCompletedOnboarding: true, onboardingCompletedAt: new Date(),
      business: { create: { name: `${tag} ${rnd()}`, slug: `b-${rnd()}`, verificationStatus: "verified", kycVerificationStatus: "verified", onboardingVerificationStatus: "approved", subscriptionTier: "premium" } },
    },
    include: { business: true },
  });
  const b = m.business!;
  await prisma.subscription.create({ data: { businessId: b.id, status: "active", planKey: "premium" } });
  const eu = await prisma.user.create({ data: { email: `emp-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "EMPLOYEE", emailVerified: true } });
  const emp = await prisma.employee.create({ data: { name: `Emp ${tag}`, jobTitle: "w", businessId: b.id, userId: eu.id, slug: `e-${rnd()}`, activationStatus: "active" } });
  const loc = await prisma.location.create({ data: { name: `Loc ${tag}`, businessId: b.id } });
  const goal = await prisma.employeeGoal.create({ data: { employeeId: emp.id, goalAmount: 100, goalPeriod: "monthly", startDate: new Date() } });
  const ticket = await prisma.supportTicket.create({ data: { ticketNumber: `T-${rnd()}`, businessId: b.id, subject: "s", category: "general" } });
  const note = await prisma.notification.create({ data: { userId: m.id, type: "x", title: "t", message: "m" } });
  const payout = await prisma.stripeConnectPayout.create({ data: { businessId: b.id, stripeAccountId: "acct_runtime", stripePayoutId: `po_${rnd()}`, amountCents: 1000, currency: "eur", status: "paid", stripeCreatedAt: new Date(), lastStripeEventCreated: 1, lastStripeEventType: "payout.paid" } });
  const batch = await prisma.employeeTipDistributionBatch.create({ data: { businessId: b.id, actorUserId: m.id, completedAt: new Date(), totalAmountCents: 100, employeeCount: 1, idempotencyKey: rnd() } });
  const order = await prisma.physicalQrOrder.create({ data: { businessId: b.id, userId: m.id, totalAmount: 100, currency: "eur", placedAt: new Date(), processingClass: "SAME_DAY", processingDeadlineAt: new Date(), processingCopySnapshot: {}, businessNameSnapshot: "x" } });
  return { m, b, eu, emp, loc, goal, ticket, note, payout, batch, order, mt: await tokenFor(m.id), et: await tokenFor(eu.id) };
}

const A = await tenant("A");
const B = await tenant("B");
let checks = 0;

// Reads: owner succeeds, other tenant does not.
for (const [path, owner, attacker] of [
  [`/api/me/connect/payouts/${A.payout.id}`, A.mt, B.mt],
  [`/api/me/connect/tip-distribution/batches/${A.batch.id}`, A.mt, B.mt],
  [`/api/business/physical-qr/orders/${A.order.id}`, A.mt, B.mt],
  [`/api/business/support/tickets/${A.ticket.id}`, A.mt, B.mt],
] as const) {
  assert.equal(await call("GET", path, owner), 200, `owner control ${path}`);
  assert.equal(await call("GET", path, attacker), 404, `attacker ${path}`);
  checks += 1;
}

// Writes: the other tenant changes nothing.
const snapshot = async () => JSON.stringify([
  await prisma.employee.findUnique({ where: { id: A.emp.id }, select: { jobTitle: true, isActive: true, slug: true, isDeleted: true } }),
  await prisma.location.findUnique({ where: { id: A.loc.id }, select: { name: true } }),
  await prisma.employeeGoal.findUnique({ where: { id: A.goal.id } }),
  await prisma.notification.findUnique({ where: { id: A.note.id } }),
]);
for (const [method, path, token, body] of [
  ["PATCH", `/api/employees/${A.emp.id}`, B.mt, { jobTitle: "Hijacked" }],
  ["PATCH", `/api/employees/${A.emp.id}/status`, B.mt, { isActive: false }],
  ["POST", `/api/employees/${A.emp.id}/regenerate-slug`, B.mt, {}],
  ["DELETE", `/api/employees/${A.emp.id}`, B.mt, undefined],
  ["PATCH", `/api/locations/${A.loc.id}`, B.mt, { name: "Hijacked" }],
  ["DELETE", `/api/locations/${A.loc.id}`, B.mt, undefined],
  ["PUT", `/api/goals/${A.goal.id}`, B.et, { goalAmount: 1 }],
  ["DELETE", `/api/goals/${A.goal.id}`, B.et, undefined],
  ["PATCH", `/api/me/notifications/${A.note.id}/read`, B.mt, {}],
  ["DELETE", `/api/me/notifications/${A.note.id}`, B.mt, undefined],
] as const) {
  const before = await snapshot();
  const status = await call(method, path, token, body);
  assert.ok(status >= 400 && status < 500, `${method} ${path} -> ${status}`);
  assert.equal(await snapshot(), before, `${method} ${path} changed state`);
  checks += 1;
}
assert.equal(await call("PUT", `/api/goals/${A.goal.id}`, A.et, { goalAmount: 150, goalPeriod: "monthly" }), 200, "goal owner control");
checks += 1;

// Roles: only platform admins reach platform routes, and approval is among them.
for (const token of [A.mt, A.et]) {
  for (const path of ["/api/platform/stats", "/api/admin/businesses", "/api/platform/audit-logs", "/api/platform/account-recovery"]) {
    assert.equal(await call("GET", path, token), 403, path);
    checks += 1;
  }
  assert.equal(await call("PATCH", `/api/platform/businesses/${A.b.id}/verify-onboarding`, token, { status: "approved" }), 403, "approval is Super Admin only");
  assert.equal(await call("PATCH", `/api/platform/businesses/${A.b.id}/verify-kyc`, token, { status: "verified" }), 403, "KYC approval is Super Admin only");
  assert.equal(await call("POST", "/api/platform/impersonate", token, { businessId: A.b.id }), 403);
  checks += 3;
}
const fakeAdmin = await prisma.user.create({ data: { email: `fake-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "SUPER_ADMIN", isPlatformAdmin: false, emailVerified: true, twoFactorEnabled: true, twoFactorSecret: "JBSWY3DPEHPK3PXP" } });
const { signAuthJwt } = await import("../src/services/auth.service.js");
const fakeRt = await issueRefreshToken(fakeAdmin.id);
const fakeToken = signAuthJwt({ sub: fakeAdmin.id, role: "SUPER_ADMIN", type: "access", tv: 0, sid: fakeRt.id });
assert.equal(await call("GET", "/api/platform/stats", fakeToken), 403, "role alone without the database flag is not enough");
checks += 1;

console.log(`cross-tenant-isolation: ok (${checks} checks)`);
await prisma.$disconnect();
server.close();
process.exit(0);
