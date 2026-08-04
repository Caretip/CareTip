/**
 * Non-destructive smoke probes for final release checklist.
 * Outputs JSON to stdout — no secrets printed.
 */
import { setTimeout as delay } from "node:timers/promises";

const API = (process.env.SMOKE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const WEB = (process.env.SMOKE_WEB_URL ?? "http://localhost:5173").replace(/\/$/, "");

/** Credentials must come from env — never commit real passwords. */
const ACCOUNTS = [
  {
    label: "businessA",
    email: process.env.SMOKE_MANAGER_B_EMAIL,
    password: process.env.SMOKE_PASSWORD,
  },
  {
    label: "businessB",
    email: process.env.SMOKE_MANAGER_EMAIL,
    password: process.env.SMOKE_PASSWORD,
  },
  {
    label: "employeeA",
    email: process.env.SMOKE_EMPLOYEE_B_EMAIL,
    password: process.env.SMOKE_PASSWORD,
  },
  {
    label: "employeeDemo",
    email: process.env.SMOKE_EMPLOYEE_EMAIL,
    password: process.env.SMOKE_PASSWORD,
  },
].filter((a) => Boolean(a.email && a.password));

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

async function login(email, password, intendedRole) {
  const r = await fetchJson(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, intendedRole }),
    credentials: "include",
  });
  const token = r.body?.token;
  if (!token) return { ok: false, status: r.status, error: r.body?.message ?? "no token" };
  return {
    ok: true,
    token,
    user: r.body.user,
    businessId: r.body.user?.businessId ?? null,
    role: r.body.user?.role,
  };
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function probeHealth() {
  const r = await fetchJson(`${API}/health`);
  return { ok: r.ok, status: r.status, uploads: r.body?.uploads ?? null };
}

async function probeWebUp() {
  try {
    const r = await fetch(WEB, { redirect: "manual" });
    return { ok: r.ok || r.status === 304, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function probeTenantIsolation() {
  const a = await login(ACCOUNTS[0].email, ACCOUNTS[0].password, "MANAGER");
  const b = await login(ACCOUNTS[1].email, ACCOUNTS[1].password, "MANAGER");
  if (!a.ok || !b.ok) {
    return {
      ok: false,
      reason: "login_failed",
      businessA: a.ok,
      businessB: b.ok,
      aError: a.error,
      bError: b.error,
    };
  }
  if (!a.businessId || !b.businessId || a.businessId === b.businessId) {
    return {
      ok: false,
      reason: "need_two_distinct_businesses",
      businessAId: a.businessId,
      businessBId: b.businessId,
    };
  }

  const statsA = await fetchJson(`${API}/api/business/me/stats?timeframe=month&scope=summary`, {
    headers: authHeaders(a.token),
    credentials: "include",
  });
  const statsB = await fetchJson(`${API}/api/business/me/stats?timeframe=month&scope=summary`, {
    headers: authHeaders(b.token),
    credentials: "include",
  });

  const employeesPublicB = await fetchJson(
    `${API}/api/employees?businessId=${encodeURIComponent(b.businessId)}`,
  );

  const patchOtherEmployee = await fetchJson(`${API}/api/employees/nonexistent-id`, {
    method: "PATCH",
    headers: authHeaders(a.token),
    body: JSON.stringify({ name: "probe" }),
    credentials: "include",
  });

  const statsLeak =
    statsA.ok &&
    statsB.ok &&
    statsA.body?.totalTips === statsB.body?.totalTips &&
    statsA.body?.tipCount === statsB.body?.tipCount &&
    (statsA.body?.tipCount ?? 0) > 0;

  const publicListHasEmail =
    Array.isArray(employeesPublicB.body) &&
    employeesPublicB.body.some((e) => typeof e?.email === "string" && e.email.includes("@"));

  return {
    ok: statsA.ok && statsB.ok && !statsLeak && !publicListHasEmail,
    businessAId: a.businessId,
    businessBId: b.businessId,
    statsA: { status: statsA.status, tipCount: statsA.body?.tipCount, totalTips: statsA.body?.totalTips },
    statsB: { status: statsB.status, tipCount: statsB.body?.tipCount, totalTips: statsB.body?.totalTips },
    statsIdentical: statsLeak,
    publicEmployeeListStatus: employeesPublicB.status,
    publicListHasEmail,
    crossPatchStatus: patchOtherEmployee.status,
  };
}

async function probeAuthCycle() {
  const login1 = await login(ACCOUNTS[0].email, ACCOUNTS[0].password, "MANAGER");
  if (!login1.ok) return { ok: false, step: "login", error: login1.error };

  const refresh = await fetchJson(`${API}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login1.token}` },
    body: "{}",
    credentials: "include",
  });

  const logout = await fetchJson(`${API}/api/auth/logout`, {
    method: "POST",
    headers: authHeaders(login1.token),
    body: "{}",
    credentials: "include",
  });

  const login2 = await login(ACCOUNTS[0].email, ACCOUNTS[0].password, "MANAGER");

  return {
    ok: login1.ok && refresh.ok && login2.ok,
    refreshStatus: refresh.status,
    refreshHasToken: Boolean(refresh.body?.token),
    logoutStatus: logout.status,
    reloginOk: login2.ok,
  };
}

async function probeStripeConfigured() {
  const r = await fetchJson(`${API}/api/payments/create-tip-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId: "probe", businessId: "probe", amount: 5 }),
  });
  const code = r.body?.code;
  return {
    stripeNotConfigured: r.status === 503 && code === "STRIPE_NOT_CONFIGURED",
    status: r.status,
    code,
  };
}

async function probePublicEmployeesNoEmail(businessId) {
  const r = await fetchJson(`${API}/api/employees?businessId=${encodeURIComponent(businessId)}`);
  if (!Array.isArray(r.body)) return { ok: false, status: r.status };
  const withEmail = r.body.filter((e) => e?.email);
  return { ok: withEmail.length === 0, count: r.body.length, withEmailCount: withEmail.length };
}

async function main() {
  if (ACCOUNTS.length < 2) {
    console.error(
      JSON.stringify({
        fatal:
          "Set SMOKE_MANAGER_EMAIL, SMOKE_MANAGER_B_EMAIL, SMOKE_EMPLOYEE_EMAIL, SMOKE_EMPLOYEE_B_EMAIL, and SMOKE_PASSWORD before running smoke probes.",
      }),
    );
    process.exit(1);
  }

  const health = await probeHealth();
  const web = await probeWebUp();
  const tenant = await probeTenantIsolation();
  const authCycle = await probeAuthCycle();
  const stripe = await probeStripeConfigured();

  let businessAId = tenant.businessAId ?? null;
  if (!businessAId) {
    const a = await login(ACCOUNTS[0].email, ACCOUNTS[0].password, "MANAGER");
    businessAId = a.businessId;
  }
  const publicEmployees = businessAId ? await probePublicEmployeesNoEmail(businessAId) : null;

  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        api: API,
        web: WEB,
        health,
        web,
        tenant,
        authCycle,
        stripe,
        publicEmployees,
        env: {
          stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
          webhookSecretSet: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
          resendConfigured: Boolean(process.env.RESEND_API_KEY?.trim()),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
