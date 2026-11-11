/**
 * Postman follow-up: tenant isolation, KYC enforcement, employee CRUD investigation.
 * Run from backend/: npx tsx scripts/runPostmanFollowUpVerification.ts
 */
import "dotenv/config";
import "../src/loadEnv.js";
import bcrypt from "bcrypt";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/prisma.js";
import { createEmployeeWithActivation } from "../src/services/employee.service.js";

const API = (process.env.SMOKE_API_URL ?? (process.env.CI ? "http://localhost:3001" : "http://127.0.0.1:9")).replace(/\/$/, "");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PASSWORD = "VerifyTest123!";
const TS = Date.now();

type ProbeResult = {
  name: string;
  method: string;
  path: string;
  status: number;
  body: unknown;
  expected: string;
  verdict: "PASS" | "FAIL" | "NOT TESTED";
};

const probes: ProbeResult[] = [];

async function fetchJson(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; cookie?: string } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* raw */
  }
  return { status: res.status, body, headers: res.headers };
}

async function login(email: string, password: string, intendedRole: string) {
  const r = await fetchJson("POST", "/api/auth/login", {
    body: { email, password, intendedRole },
  });
  const token = (r.body as { token?: string })?.token ?? null;
  return { status: r.status, token, body: r.body };
}

function record(
  name: string,
  method: string,
  path: string,
  status: number,
  body: unknown,
  expected: string,
  verdict: "PASS" | "FAIL" | "NOT TESTED",
) {
  probes.push({ name, method, path, status, body, expected, verdict });
}

function expectStatus(
  name: string,
  method: string,
  path: string,
  status: number,
  body: unknown,
  allowed: number[],
  label: string,
) {
  const ok = allowed.includes(status);
  record(name, method, path, status, body, label, ok ? "PASS" : "FAIL");
  return ok;
}

async function seedVerifiedBusiness(suffix: string) {
  const email = `verify-${suffix}-${TS}@caretip-test.local`;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const slug = `verify-${suffix}-${TS}`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      onboardingCompletedAt: new Date(),
    },
  });

  const business = await prisma.business.create({
    data: {
      name: `Verify Business ${suffix.toUpperCase()}`,
      slug,
      userId: user.id,
      verificationStatus: "verified",
      subscriptionTier: "premium",
      businessType: "Restaurant",
      location: "Berlin",
    },
  });

  const empUser = await prisma.user.create({
    data: {
      email: `verify-${suffix}-staff-${TS}@caretip-test.local`,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "EMPLOYEE",
      emailVerified: true,
    },
  });

  const employee = await prisma.employee.create({
    data: {
      name: `Staff ${suffix.toUpperCase()}`,
      jobTitle: "Server",
      businessId: business.id,
      userId: empUser.id,
      activationStatus: "active",
      isActive: true,
      slug: `${slug}-staff`,
    },
  });

  const location = await prisma.location.create({
    data: {
      name: `Location ${suffix.toUpperCase()}`,
      businessId: business.id,
      description: "Verification probe",
    },
  });

  const table = await prisma.table.create({
    data: {
      name: `Table ${suffix.toUpperCase()}`,
      locationId: location.id,
      qrSlug: `verify-${suffix}-table-${TS}`,
    },
  });

  await prisma.transaction.create({
    data: {
      amount: suffix === "tenant-a" ? 12.5 : 25.75,
      status: "success",
      businessId: business.id,
      employeeId: employee.id,
      locationId: location.id,
      tableId: table.id,
    },
  });

  return { email, user, business, employee, location, table };
}

async function seedPendingKycBusiness() {
  const email = `verify-pending-kyc-${TS}@caretip-test.local`;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const slug = `verify-pending-kyc-${TS}`;

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "MANAGER",
      emailVerified: true,
      hasCompletedOnboarding: true,
      onboardingCompletedAt: new Date(),
    },
  });

  const business = await prisma.business.create({
    data: {
      name: "Verify Pending KYC",
      slug,
      userId: user.id,
      verificationStatus: "pending",
      subscriptionTier: "premium",
    },
  });

  return { email, user, business };
}

async function investigateEmployeeCrud(managerToken: string, businessId: string) {
  const investigations: Array<{
    scenario: string;
    status: number;
    body: unknown;
    classification: "PASS" | "FAIL" | "EXPECTED VALIDATION FAILURE";
    notes: string;
  }> = [];

  const cases = [
    {
      scenario: "Newman probe — legacy create (caretip.de email)",
      body: {
        name: "Newman Probe Staff",
        role: "Server",
        email: `newman-probe-${TS}@caretip.de`,
      },
    },
    {
      scenario: "Newman probe — legacy create (caretip.local email)",
      body: {
        name: "Newman Probe Staff",
        role: "Server",
        email: `newman-probe-${TS}@caretip.local`,
      },
    },
    {
      scenario: "Missing name",
      body: { role: "Server", email: `missing-name-${TS}@caretip-test.local` },
    },
    {
      scenario: "Missing email",
      body: { name: "No Email", role: "Server" },
    },
    {
      scenario: "Activation flow (useActivationFlow: true)",
      body: {
        name: "Activation Flow Staff",
        role: "Server",
        email: `activation-flow-${TS}@caretip-test.local`,
        useActivationFlow: true,
      },
    },
    {
      scenario: "Valid legacy create (unique email)",
      body: {
        name: "Valid Legacy Staff",
        role: "Server",
        email: `valid-legacy-${TS}@caretip-test.local`,
      },
    },
  ];

  for (const c of cases) {
    const r = await fetchJson("POST", "/api/employees", {
      token: managerToken,
      body: c.body,
    });
    let classification: "PASS" | "FAIL" | "EXPECTED VALIDATION FAILURE" = "FAIL";
    let notes = "";
    const msg = String((r.body as { message?: string })?.message ?? "");

    if (r.status === 201) {
      classification = "PASS";
      notes = "Employee created successfully";
    } else if (r.status === 400 && /required|already registered|must be an array/i.test(msg)) {
      classification = "EXPECTED VALIDATION FAILURE";
      notes = msg;
    } else if (r.status === 400) {
      classification = "FAIL";
      notes = `Unexpected 400: ${msg}`;
    } else {
      classification = "FAIL";
      notes = `Status ${r.status}: ${msg}`;
    }

    investigations.push({
      scenario: c.scenario,
      status: r.status,
      body: r.body,
      classification,
      notes,
    });
  }

  // Direct service-layer probe (bypasses HTTP) for root cause
  let serviceError: string | null = null;
  let serviceOk = false;
  try {
    await createEmployeeWithActivation({
      name: "Service Layer Probe",
      jobTitle: "Server",
      email: `service-layer-${TS}@caretip-test.local`,
      businessId,
    });
    serviceOk = true;
  } catch (e) {
    serviceError = e instanceof Error ? e.message : String(e);
  }

  investigations.push({
    scenario: "Direct createEmployeeWithActivation() service call",
    status: serviceOk ? 201 : 500,
    body: serviceOk ? { ok: true } : { error: serviceError },
    classification: serviceOk ? "PASS" : "FAIL",
    notes: serviceOk ? "Service layer succeeds — HTTP wrapper or middleware issue if API fails" : serviceError ?? "",
  });

  return investigations;
}

async function runTenantProbes(
  label: string,
  tokenA: string,
  tokenB: string,
  ids: {
    businessBId: string;
    employeeBId: string;
    locationBId: string;
    tableBId: string;
    ticketBId?: string;
  },
) {
  const asA = (path: string, method = "GET", body?: unknown) =>
    fetchJson(method, path, { token: tokenA, body });

  // Analytics / stats
  const statsA = await asA("/api/business/me/stats?timeframe=month&scope=summary");
  const statsB = await asA("/api/business/me/stats?timeframe=month&scope=analytics");
  expectStatus(
    `${label} — stats summary (own business)`,
    "GET",
    "/api/business/me/stats",
    statsA.status,
    statsA.body,
    [200],
    "200 own stats",
  );

  // Cross-tenant employee PATCH
  const patchEmp = await asA(`/api/employees/${ids.employeeBId}`, "PATCH", { name: "Hacked" });
  expectStatus(
    `${label} — PATCH Business B employee`,
    "PATCH",
    `/api/employees/${ids.employeeBId}`,
    patchEmp.status,
    patchEmp.body,
    [403, 404],
    "403 or 404",
  );

  // Cross-tenant employee DELETE
  const delEmp = await asA(`/api/employees/${ids.employeeBId}`, "DELETE");
  expectStatus(
    `${label} — DELETE Business B employee`,
    "DELETE",
    `/api/employees/${ids.employeeBId}`,
    delEmp.status,
    delEmp.body,
    [403, 404],
    "403 or 404",
  );

  // Locations — must not include Business B rows
  const locA = await asA("/api/locations");
  const locList = Array.isArray(locA.body) ? (locA.body as Array<{ id?: string }>) : [];
  const leakedLoc = locList.some((l) => l.id === ids.locationBId);
  record(
    `${label} — locations list (own business only)`,
    "GET",
    "/api/locations",
    locA.status,
    { count: locList.length, leakedBusinessB: leakedLoc },
    "200 without Business B locations",
    locA.status === 200 && !leakedLoc ? "PASS" : "FAIL",
  );

  // Tables — must not include Business B rows
  const tablesA = await asA("/api/tables");
  const tableList = Array.isArray(tablesA.body) ? (tablesA.body as Array<{ id?: string }>) : [];
  const leakedTable = tableList.some((t) => t.id === ids.tableBId);
  record(
    `${label} — tables list (own business only)`,
    "GET",
    "/api/tables",
    tablesA.status,
    { count: tableList.length, leakedBusinessB: leakedTable },
    "200 without Business B tables",
    tablesA.status === 200 && !leakedTable ? "PASS" : "FAIL",
  );

  // Tips — should only return A's data (implicit); compare tip lists don't include B employee names incorrectly
  const tipsA = await asA("/api/tips/business?limit=20");
  expectStatus(
    `${label} — tips list`,
    "GET",
    "/api/tips/business",
    tipsA.status,
    tipsA.body,
    [200],
    "200 tips",
  );

  // Export
  const exportA = await asA("/api/transactions/export");
  expectStatus(
    `${label} — transactions export`,
    "GET",
    "/api/transactions/export",
    exportA.status,
    exportA.body,
    [200, 403],
    "200 or 403 subscription",
  );

  // Public employees for B — should not leak emails
  const pubB = await fetchJson("GET", `/api/employees?businessId=${ids.businessBId}`);
  const hasEmail =
    Array.isArray(pubB.body) &&
    (pubB.body as Array<{ email?: string }>).some((e) => Boolean(e.email));
  record(
    `${label} — public employees B no email`,
    "GET",
    `/api/employees?businessId=${ids.businessBId}`,
    pubB.status,
    hasEmail ? { leak: true, sample: pubB.body } : { count: (pubB.body as unknown[])?.length },
    "200 without email field",
    pubB.status === 200 && !hasEmail ? "PASS" : "FAIL",
  );

  // Stats isolation: login B and ensure different businessId in profile
  const loginB = await login(
    (await prisma.business.findUnique({ where: { id: ids.businessBId }, include: { user: true } }))!
      .user.email,
    PASSWORD,
    "MANAGER",
  );
  if (loginB.token) {
    const statsBOwn = await fetchJson("GET", "/api/business/me/stats?timeframe=month&scope=summary", {
      token: loginB.token,
    });
    const statsAJson = statsA.body as { tipCount?: number; totalTips?: number };
    const statsBJson = statsBOwn.body as { tipCount?: number; totalTips?: number };
    const sameStats =
      statsA.status === 200 &&
      statsBOwn.status === 200 &&
      statsAJson.tipCount === statsBJson.tipCount &&
      statsAJson.totalTips === statsBJson.totalTips &&
      (statsAJson.tipCount ?? 0) > 0;
    record(
      `${label} — stats A vs B distinct`,
      "GET",
      "/api/business/me/stats",
      statsBOwn.status,
      { statsA: statsAJson, statsB: statsBJson },
      "Distinct tip totals per business",
      statsA.status === 200 && statsBOwn.status === 200 && !sameStats ? "PASS" : sameStats ? "FAIL" : "NOT TESTED",
    );
  }
}

async function runKycProbes(approvedToken: string, pendingToken: string) {
  const gated = [
    { name: "stats summary", path: "/api/business/me/stats?timeframe=month&scope=summary" },
    { name: "employees create", path: "/api/employees", method: "POST" as const, body: { name: "KYC Probe", role: "Server", email: `kyc-probe-${TS}@caretip-test.local` } },
    { name: "locations list", path: "/api/locations" },
    { name: "tables list", path: "/api/tables" },
    { name: "tips business", path: "/api/tips/business?limit=5" },
    { name: "transactions export", path: "/api/transactions/export" },
  ];

  for (const g of gated) {
    const approved = await fetchJson(g.method ?? "GET", g.path, {
      token: approvedToken,
      body: g.body,
    });
    expectStatus(
      `KYC approved — ${g.name}`,
      g.method ?? "GET",
      g.path,
      approved.status,
      approved.body,
      g.name.includes("export") ? [200, 403] : [200, 201],
      "200/201 approved",
    );

    const pending = await fetchJson(g.method ?? "GET", g.path, {
      token: pendingToken,
      body: g.body,
    });
    expectStatus(
      `KYC pending — ${g.name}`,
      g.method ?? "GET",
      g.path,
      pending.status,
      pending.body,
      [403],
      "403 pending verification",
    );
  }

  // Profile poll allowed for pending
  const profilePending = await fetchJson("GET", "/api/business/profile", { token: pendingToken });
  expectStatus(
    "KYC pending — profile poll",
    "GET",
    "/api/business/profile",
    profilePending.status,
    profilePending.body,
    [200],
    "200 profile allowed",
  );
}

function mdTenantReport(data: {
  at: string;
  businessA: { email: string; id: string };
  businessB: { email: string; id: string };
  probes: ProbeResult[];
}) {
  const tenantProbes = data.probes.filter((p) => p.name.startsWith("Tenant —"));
  const pass = tenantProbes.filter((p) => p.verdict === "PASS").length;
  const fail = tenantProbes.filter((p) => p.verdict === "FAIL").length;
  const nt = tenantProbes.filter((p) => p.verdict === "NOT TESTED").length;

  return `# Tenant Isolation Verification

**Generated:** ${data.at}  
**API:** ${API}  
**Business A:** \`${data.businessA.email}\` (\`${data.businessA.id}\`)  
**Business B:** \`${data.businessB.email}\` (\`${data.businessB.id}\`)  
**Password (both):** \`${PASSWORD}\`

---

## Summary

| Verdict | Count |
|---------|------:|
| PASS | ${pass} |
| FAIL | ${fail} |
| NOT TESTED | ${nt} |

**Overall:** ${fail === 0 && nt === 0 ? "**PASS**" : fail > 0 ? "**FAIL**" : "**PARTIAL — see gaps**"}

Both businesses were created with \`verificationStatus: verified\`, completed onboarding, seed employee, location, table, and tip transaction.

---

## Results

| Test | Method | Status | Expected | Verdict |
|------|--------|--------|----------|---------|
${tenantProbes.map((p) => `| ${p.name} | ${p.method} | ${p.status} | ${p.expected} | **${p.verdict}** |`).join("\n")}

---

## Detail

${tenantProbes
  .map(
    (p) => `### ${p.name} — ${p.verdict}

- **Request:** \`${p.method} ${p.path}\`
- **Response:** \`${p.status}\`
- **Body:** \`\`\`json
${JSON.stringify(p.body, null, 2).slice(0, 800)}
\`\`\`
`,
  )
  .join("\n")}
`;
}

function mdKycReport(data: {
  at: string;
  approved: { email: string; id: string };
  pending: { email: string; id: string };
  probes: ProbeResult[];
}) {
  const kycProbes = data.probes.filter((p) => p.name.startsWith("KYC"));
  const pass = kycProbes.filter((p) => p.verdict === "PASS").length;
  const fail = kycProbes.filter((p) => p.verdict === "FAIL").length;

  return `# KYC Enforcement Verification

**Generated:** ${data.at}  
**API:** ${API}  
**Approved:** \`${data.approved.email}\` (\`${data.approved.id}\`, \`verificationStatus: verified\`)  
**Pending:** \`${data.pending.email}\` (\`${data.pending.id}\`, \`verificationStatus: pending\`)  
**Password:** \`${PASSWORD}\`

---

## Summary

| Verdict | Count |
|---------|------:|
| PASS | ${pass} |
| FAIL | ${fail} |

**Overall:** ${fail === 0 ? "**PASS**" : "**FAIL**"}

\`isApprovedBusiness\` middleware returns **403** \`Account pending verification.\` for pending managers on gated routes. \`GET /api/business/profile\` remains open for KYC polling.

---

## Results

| Test | Method | Status | Expected | Verdict |
|------|--------|--------|----------|---------|
${kycProbes.map((p) => `| ${p.name} | ${p.method} | ${p.status} | ${p.expected} | **${p.verdict}** |`).join("\n")}

---

## Detail

${kycProbes
  .map(
    (p) => `### ${p.name} — ${p.verdict}

- **Request:** \`${p.method} ${p.path}\`
- **Response:** \`${p.status}\`
- **Body:** \`\`\`json
${JSON.stringify(p.body, null, 2)}
\`\`\`
`,
  )
  .join("\n")}
`;
}

function mdCrudReport(data: {
  at: string;
  investigations: Awaited<ReturnType<typeof investigateEmployeeCrud>>;
}) {
  const pass = data.investigations.filter((i) => i.classification === "PASS").length;
  const fail = data.investigations.filter((i) => i.classification === "FAIL").length;
  const ev = data.investigations.filter((i) => i.classification === "EXPECTED VALIDATION FAILURE").length;
  const overall =
    fail === 0 && pass >= 1 ? "PASS" : fail > 0 && pass >= 1 ? "PARTIAL PASS" : fail > 0 ? "FAIL" : "INCONCLUSIVE";

  return `# Employee CRUD Investigation

**Generated:** ${data.at}  
**Endpoint:** \`POST /api/employees\`  
**Prior Newman failure:** HTTP 400 with generic message

---

## Summary

| Classification | Count |
|----------------|------:|
| PASS | ${pass} |
| FAIL | ${fail} |
| EXPECTED VALIDATION FAILURE | ${ev} |

**Overall:** **${overall}**

---

## Root cause

See investigation table below. Compare HTTP responses vs direct \`createEmployee()\` service call.

---

## Investigations

| Scenario | HTTP Status | Classification | Notes |
|----------|------------:|------------------|-------|
${data.investigations.map((i) => `| ${i.scenario} | ${i.status} | **${i.classification}** | ${i.notes.replace(/\|/g, "\\|")} |`).join("\n")}

---

## Response bodies

${data.investigations
  .map(
    (i) => `### ${i.scenario}

\`\`\`json
${JSON.stringify(i.body, null, 2)}
\`\`\`
`,
  )
  .join("\n")}

---

## Recommendation

- Use \`useActivationFlow: true\` for production staff invites if legacy create fails in your environment.
- Ensure test emails use unique addresses; duplicate email returns **EXPECTED VALIDATION FAILURE**.
- Newman collection should expect **201** for valid legacy or activation create, not accept **400** as pass.
`;
}

async function main() {
  console.log("Seeding verification businesses...");
  const bizA = await seedVerifiedBusiness("tenant-a");
  const bizB = await seedVerifiedBusiness("tenant-b");
  const pending = await seedPendingKycBusiness();

  const loginA = await login(bizA.email, PASSWORD, "MANAGER");
  const loginB = await login(bizB.email, PASSWORD, "MANAGER");
  const loginPending = await login(pending.email, PASSWORD, "MANAGER");
  const loginApproved = loginA;

  if (!loginA.token || !loginB.token || !loginPending.token) {
    throw new Error(
      `Login failed: A=${loginA.status} B=${loginB.status} pending=${loginPending.status}`,
    );
  }

  console.log("Running tenant isolation probes...");
  await runTenantProbes("Tenant", loginA.token, loginB.token, {
    businessBId: bizB.business.id,
    employeeBId: bizB.employee.id,
    locationBId: bizB.location.id,
    tableBId: bizB.table.id,
  });

  console.log("Running KYC probes...");
  await runKycProbes(loginApproved.token!, loginPending.token!);

  console.log("Investigating employee CRUD...");
  const crudInvestigations = await investigateEmployeeCrud(loginA.token, bizA.business.id);

  const at = new Date().toISOString();
  const payload = {
    at,
    businessA: { email: bizA.email, id: bizA.business.id },
    businessB: { email: bizB.email, id: bizB.business.id },
    pending: { email: pending.email, id: pending.business.id },
    probes,
    crudInvestigations,
  };

  writeFileSync(join(ROOT, "verification-results.json"), JSON.stringify(payload, null, 2));
  writeFileSync(join(ROOT, "tenant-isolation-verification.md"), mdTenantReport(payload));
  writeFileSync(join(ROOT, "kyc-enforcement-verification.md"), mdKycReport({
    at: payload.at,
    approved: payload.businessA,
    pending: payload.pending,
    probes: payload.probes,
  }));
  writeFileSync(join(ROOT, "employee-crud-investigation.md"), mdCrudReport({ at, investigations: crudInvestigations }));

  console.log("Done. Wrote verification-results.json and 3 markdown reports.");
  console.log(
    JSON.stringify({
      tenant: {
        pass: probes.filter((p) => p.name.includes("Tenant") && p.verdict === "PASS").length,
        fail: probes.filter((p) => p.name.includes("Tenant") && p.verdict === "FAIL").length,
      },
      kyc: {
        pass: probes.filter((p) => p.name.startsWith("KYC") && p.verdict === "PASS").length,
        fail: probes.filter((p) => p.name.startsWith("KYC") && p.verdict === "FAIL").length,
      },
      crud: crudInvestigations.map((i) => ({ scenario: i.scenario, classification: i.classification })),
    }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
