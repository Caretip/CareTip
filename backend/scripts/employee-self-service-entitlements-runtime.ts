/**
 * Employee self-service is not tied to the employer's plan; business plan checks are unchanged.
 * Disposable database only. Run: node scripts/safe-test.mjs test:employee-self-service-entitlements
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import bcrypt from "bcrypt";
import express from "express";
import { BillingCycle, SubscriptionPlanKey, SubscriptionStatus } from "@prisma/client";

if (process.env.CARETIP_TEST_ISOLATION !== "1") throw new Error("disposable database only (run through safe-test)");
delete process.env.REDIS_URL;
console.info = () => {};

const { prisma } = await import("../src/prisma.js");
const { default: goalsRoutes } = await import("../src/routes/goals.routes.js");
const { default: employeeRoutes } = await import("../src/routes/employee.routes.js");
const { default: tipsRoutes } = await import("../src/routes/tips.routes.js");
const { default: businessRoutes } = await import("../src/routes/business.routes.js");
const { issueRefreshToken } = await import("../src/services/refreshToken.service.js");
const { authResultForUserId } = await import("../src/services/auth.service.js");
const { provisionInternalBasicSubscription } = await import("../src/services/subscription.service.js");
const { capabilitiesForTier } = await import("../src/config/subscriptionCapabilities.js");
const { hasFeature } = await import("../src/services/subscriptionEntitlement.service.js");
const { listEmployeeGoalsForBusiness } = await import("../src/services/goal.service.js");

const app = express();
app.use(express.json());
app.use("/api/goals", goalsRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/tips", tipsRoutes);
app.use("/api/business", businessRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const rnd = () => Math.random().toString(36).slice(2, 10);
const HASH = await bcrypt.hash("Entitlement-Synthetic-Pw-1!", 4);
async function token(userId: string) {
  const rt = await issueRefreshToken(userId);
  return (await authResultForUserId(userId, { refreshSessionId: rt.id })).token as string;
}
async function call(method: string, path: string, tok: string, body?: unknown) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${tok}`, "x-caretip-client": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A hung request fails the test quickly instead of waiting out the 300 s fetch default.
    signal: AbortSignal.timeout(20_000),
  }).catch((e: { name?: string; cause?: { code?: string; message?: string } }) => {
    if (e?.name === "TimeoutError") throw new Error(`${method} ${path}: no response within 20 s (hung)`);
    throw new Error(`${method} ${path}: ${e?.cause?.code ?? e?.cause?.message ?? String(e)}`);
  });
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(await r.text()); } catch { /* empty */ }
  return { status: r.status, json };
}

async function venue(plan: "basic" | "premium") {
  const manager = await prisma.user.create({
    data: {
      email: `mgr-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "MANAGER", emailVerified: true,
      hasCompletedOnboarding: true, onboardingCompletedAt: new Date(),
      business: { create: { name: `Venue ${rnd()}`, slug: `v-${rnd()}`, verificationStatus: "verified", kycVerificationStatus: "verified", onboardingVerificationStatus: "approved" } },
    },
    include: { business: true },
  });
  const businessId = manager.business!.id;
  if (plan === "basic") await provisionInternalBasicSubscription(businessId);
  else await prisma.subscription.create({ data: { businessId, planKey: SubscriptionPlanKey.premium, status: SubscriptionStatus.active, billingCycle: BillingCycle.monthly } });
  const empUser = await prisma.user.create({ data: { email: `emp-${rnd()}@runtime.invalid`, passwordHash: HASH, role: "EMPLOYEE", emailVerified: true } });
  const employee = await prisma.employee.create({ data: { name: "Staff Member", jobTitle: "Server", businessId, userId: empUser.id } });
  return { businessId, manager, managerToken: await token(manager.id), employee, employeeToken: await token(empUser.id) };
}

let count = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  count++;
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (err) {
    failures.push(name);
    process.stdout.write(`FAIL ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

const basic = await venue("basic");
const pro = await venue("premium");
const today = new Date().toISOString().slice(0, 10);

await test("1. employee of a Basic business: own tip goals work (list, create, update, monthly goal) without Pro", async () => {
  const list = await call("GET", "/api/goals", basic.employeeToken);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  const created = await call("POST", "/api/goals", basic.employeeToken, { name: "Weekly target", goalAmount: 150, goalPeriod: "weekly", startDate: today });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const goalId = (created.json.goal as { id: string }).id;
  const upd = await call("PUT", `/api/goals/${goalId}`, basic.employeeToken, { name: "Weekly target", goalAmount: 180, goalPeriod: "weekly", startDate: today });
  assert.equal(upd.status, 200, JSON.stringify(upd.json));
  const me = await call("GET", "/api/employees/me/goal", basic.employeeToken);
  assert.equal(me.status, 200, JSON.stringify(me.json));
  const put = await call("PUT", "/api/employees/me/goal", basic.employeeToken, { goalAmount: 400, goalPeriod: "monthly", startDate: today });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const profile = await call("PATCH", "/api/employees/me", basic.employeeToken, { monthlyGoal: 500 });
  assert.equal(profile.status, 200, JSON.stringify(profile.json));
  const bad = await call("PATCH", "/api/employees/me", basic.employeeToken, { monthlyGoal: -1 });
  assert.equal(bad.status, 400, "own monthly goal still validated");
});

await test("2. employee of a Basic business: own analytics (all scopes) and goal progress are returned", async () => {
  for (const scope of ["account", "summary", "analytics", "full"]) {
    const r = await call("GET", `/api/tips/employee?scope=${scope}&timeframe=week`, basic.employeeToken);
    assert.equal(r.status, 200, `${scope}: ${JSON.stringify(r.json)}`);
  }
  const full = await call("GET", "/api/tips/employee", basic.employeeToken);
  assert.equal(full.status, 200);
  assert.ok("goal" in full.json && full.json.goal !== undefined, "goal progress not masked");
  const list = await call("GET", "/api/tips/employee/list?range=month", basic.employeeToken);
  assert.equal(list.status, 200);
  assert.ok(Array.isArray((list.json as { tips?: unknown[] }).tips ?? (list.json as { items?: unknown[] }).items ?? []), "empty state is a list, not an error");
});

await test("2b. scope=full with a timeframe answers, also when requested concurrently (was a deadlock for every plan)", async () => {
  for (const v of [basic, pro]) {
    for (const tf of ["today", "week", "month"]) {
      const started = Date.now();
      const rs = await Promise.all(
        [0, 1, 2].map(() => call("GET", `/api/tips/employee?scope=full&timeframe=${tf}`, v.employeeToken)),
      );
      for (const r of rs) {
        assert.equal(r.status, 200, `${tf}: ${JSON.stringify(r.json)}`);
        assert.ok(Array.isArray(r.json.tips) && Array.isArray(r.json.chartSeries), "full payload shape");
        assert.equal(typeof r.json.periodAmountEur, "number");
      }
      assert.ok(Date.now() - started < 15_000, `${tf} took ${Date.now() - started} ms`);
    }
  }
});

await test("3. an employee cannot read or change another employee's goals", async () => {
  const other = await call("POST", "/api/goals", pro.employeeToken, { name: "Other", goalAmount: 99, goalPeriod: "daily", startDate: today });
  assert.equal(other.status, 201);
  const otherId = (other.json.goal as { id: string }).id;
  const tamper = await call("PUT", `/api/goals/${otherId}`, basic.employeeToken, { name: "x", goalAmount: 1, goalPeriod: "daily", startDate: today });
  assert.ok(tamper.status === 404 || tamper.status === 403, `got ${tamper.status}`);
  const del = await call("DELETE", `/api/goals/${otherId}`, basic.employeeToken);
  assert.ok(del.status === 404 || del.status === 403, `got ${del.status}`);
  const mine = await call("GET", "/api/goals", basic.employeeToken);
  assert.ok(!JSON.stringify(mine.json).includes(otherId), "other employee's goal not listed");
});

await test("4. employees cannot use manager-only analytics or staff management", async () => {
  assert.equal((await call("GET", "/api/tips/business", basic.employeeToken)).status, 403);
  assert.equal((await call("PATCH", `/api/employees/${basic.employee.id}`, basic.employeeToken, { monthlyGoal: 10 })).status, 403);
  assert.equal((await call("GET", "/api/goals", basic.managerToken)).status, 403, "goal self-service is employee-only");
});

async function activeGoalAmounts(employeeId: string) {
  const rows = await prisma.employeeGoal.findMany({ where: { employeeId, status: "active" }, select: { goalAmount: true } });
  return rows.map((r) => Number(r.goalAmount)).sort((a, b) => a - b);
}

await test("5. managers cannot set or clear an employee's tip goal, on any plan (employees set their own)", async () => {
  for (const v of [basic, pro]) {
    const before = await activeGoalAmounts(v.employee.id);
    for (const monthlyGoal of [300, null, ""]) {
      const r = await call("PATCH", `/api/employees/${v.employee.id}`, v.managerToken, { monthlyGoal });
      assert.equal(r.status, 400, `${JSON.stringify(monthlyGoal)}: ${JSON.stringify(r.json)}`);
      assert.equal(r.json.code, "EMPLOYEE_GOAL_SELF_SERVICE_ONLY");
    }
    assert.deepEqual(await activeGoalAmounts(v.employee.id), before, "employee's goals untouched");
    // Ordinary staff edits (no goal) still work for the manager.
    const ok = await call("PATCH", `/api/employees/${v.employee.id}`, v.managerToken, { name: "Staff Member Renamed" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
  }
});

await test("6. Basic business: plan entitlements unchanged (no team goal tracking, no advanced analytics)", async () => {
  assert.equal(await hasFeature(basic.businessId, "employeeGoals"), false);
  assert.equal(await hasFeature(basic.businessId, "advancedAnalytics"), false);
});

await test("7. Pro business: keeps team goal tracking, which shows the goals employees set themselves", async () => {
  assert.equal(await hasFeature(pro.businessId, "employeeGoals"), true);
  assert.equal(await hasFeature(pro.businessId, "advancedAnalytics"), true);
  const tracked = await listEmployeeGoalsForBusiness(pro.businessId, { maxGoals: 25 });
  assert.ok(
    tracked.some((g: { employeeId?: string; goalAmount?: number }) => g.employeeId === pro.employee.id && Number(g.goalAmount) === 99),
    `tracking lists the employee-set goal: ${JSON.stringify(tracked)}`,
  );
});

await test("8. plan matrix unchanged: Basic lacks employeeGoals/advancedAnalytics, Pro and Enterprise have them", async () => {
  assert.ok(!capabilitiesForTier("basic").includes("employeeGoals"));
  assert.ok(!capabilitiesForTier("basic").includes("advancedAnalytics"));
  for (const t of ["premium", "enterprise"] as const) {
    assert.ok(capabilitiesForTier(t).includes("employeeGoals"), t);
    assert.ok(capabilitiesForTier(t).includes("advancedAnalytics"), t);
  }
});

server.close();
await prisma.$disconnect();
console.log(failures.length ? `\n${failures.length} of ${count} failed` : `\nemployee-self-service-entitlements: ok (${count} checks)`);
process.exit(failures.length ? 1 : 0);
