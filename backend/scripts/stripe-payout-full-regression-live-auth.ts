/**
 * Deployed Render auth/payout GET checks. Prints statuses only; no tokens.
 * Stripe TEST Instant POST is optional via LIVE_INSTANT_POST=1.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";

const RENDER = "https://caretip.onrender.com";
const ORIGIN = "https://caretip.de";
const MANAGER_EMAIL = "mgr_p26_1786691378148@caretip-test.local";
const JORDAN_EMAIL = "jordan.p26_1786691378148@caretip-test.local";
const SAM_EMAIL = "sam.p26_1786691378148@caretip-test.local";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";

function suffix(id: string | null | undefined) {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}

async function renderJson(path: string, init: RequestInit & { token?: string }) {
  const headers = new Headers(init.headers);
  headers.set("x-caretip-client", "1");
  headers.set("Origin", ORIGIN);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const { token: _t, ...rest } = init;
  const res = await fetch(`${RENDER}${path}`, { ...rest, headers });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 120) };
  }
  return { status: res.status, json };
}

async function signin(email: string) {
  const res = await renderJson("/api/auth/signin", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const token =
    res.json && typeof res.json === "object" && "token" in res.json
      ? String((res.json as { token?: string }).token ?? "")
      : "";
  return { status: res.status, hasToken: Boolean(token), token };
}

async function main() {
  const health = await fetch(`${RENDER}/api/health`).then((r) => r.json()) as {
    status?: string;
    uptime?: number;
    environment?: string;
    database?: string;
  };
  console.log(`health status=${health.status} db=${health.database} env=${health.environment} uptime=${health.uptime}`);

  const jordan = await signin(JORDAN_EMAIL);
  const mgr = await signin(MANAGER_EMAIL);
  const sam = await signin(SAM_EMAIL);
  console.log(`auth jordan=${jordan.status} mgr=${mgr.status} sam=${sam.status}`);

  const jStatus = await renderJson("/api/me/employee-connect/status", { token: jordan.token });
  const jInstant = await renderJson("/api/me/employee-connect/instant-payout", { token: jordan.token });
  const jHist = await renderJson("/api/me/employee-connect/stripe-payouts?take=50", { token: jordan.token });
  const jPay = await renderJson("/api/me/employee-connect/payables?take=20", { token: jordan.token });
  const jBizInstant = await renderJson("/api/me/connect/instant-payout", { token: jordan.token });
  const jMode = await renderJson("/api/me/connect/employee-tip-payout-mode", { token: jordan.token });
  const mMode = await renderJson("/api/me/connect/employee-tip-payout-mode", { token: mgr.token });
  const mEmpInstant = await renderJson("/api/me/employee-connect/instant-payout", { token: mgr.token });
  const mBizInstant = await renderJson("/api/me/connect/instant-payout", { token: mgr.token });
  const sHist = await renderJson("/api/me/employee-connect/stripe-payouts?take=50", { token: sam.token });
  const steer = await renderJson("/api/me/employee-connect/instant-payout", {
    token: jordan.token,
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: "steer_denied_regression_01",
      amount: 99999,
      destination: "acct_ATTACKER",
      employeeId: "other",
      businessId: "other",
    }),
  });

  const js = jStatus.json as Record<string, unknown> | null;
  const ji = jInstant.json as Record<string, unknown> | null;
  const jh = jHist.json as { items?: unknown[]; stripeReadable?: boolean } | null;
  const jp = jPay.json as { items?: Array<{ status?: string; chargeModel?: string }>; total?: number } | null;
  const sh = sHist.json as { items?: unknown[] } | null;

  console.log(
    `jordan status=${jStatus.status} mode=${js?.employeeTipPayoutMode ?? "(missing)"} connect=${js?.connectionState}`,
  );
  console.log(
    `jordan instant GET=${jInstant.status} eligible=${ji?.eligible} reason=${ji?.reason} net=${ji?.instantAvailableNetCents} min=${ji?.minPayoutCents}`,
  );
  console.log(
    `jordan stripe-payouts GET=${jHist.status} readable=${jh?.stripeReadable} items=${jh?.items?.length ?? 0}`,
  );
  console.log(`jordan payables GET=${jPay.status} total=${jp?.total ?? 0}`);
  console.log(`jordan->business instant=${jBizInstant.status} jordan->mode=${jMode.status}`);
  console.log(`manager->mode=${mMode.status} bodyMode=${(mMode.json as { mode?: string } | null)?.mode}`);
  console.log(`manager->employee instant=${mEmpInstant.status} manager->business instant=${mBizInstant.status}`);
  console.log(`sam stripe-payouts GET=${sHist.status} items=${sh?.items?.length ?? 0}`);
  console.log(`jordan instant POST steer=${steer.status}`);

  const biz = await prisma.business.findUnique({
    where: { id: "cmpy3xoc90003u7o0eqdf55c6" },
    select: { employeeTipPayoutMode: true, name: true },
  });
  console.log(`fixture_business_mode=${biz?.employeeTipPayoutMode} name_len=${biz?.name?.length ?? 0}`);

  if (process.env.LIVE_INSTANT_POST === "1" && ji?.eligible === true) {
    const key = `fullreg_${Date.now()}`;
    const first = await renderJson("/api/me/employee-connect/instant-payout", {
      token: jordan.token,
      method: "POST",
      body: JSON.stringify({ idempotencyKey: key }),
    });
    const second = await renderJson("/api/me/employee-connect/instant-payout", {
      token: jordan.token,
      method: "POST",
      body: JSON.stringify({ idempotencyKey: key }),
    });
    const p1 = first.json as { payout?: { stripePayoutId?: string; amountCents?: number; method?: string } } | null;
    const p2 = second.json as { payout?: { stripePayoutId?: string } } | null;
    console.log(
      `instant POST first=${first.status} po=${suffix(p1?.payout?.stripePayoutId)} amount=${p1?.payout?.amountCents} method=${p1?.payout?.method}`,
    );
    console.log(
      `instant POST replay=${second.status} po=${suffix(p2?.payout?.stripePayoutId)} same=${p1?.payout?.stripePayoutId === p2?.payout?.stripePayoutId}`,
    );
    const hist2 = await renderJson("/api/me/employee-connect/stripe-payouts?take=50", { token: jordan.token });
    const h2 = hist2.json as { items?: Array<{ stripePayoutId?: string; method?: string; amountCents?: number }> } | null;
    const found = h2?.items?.some((it) => it.stripePayoutId === p1?.payout?.stripePayoutId);
    console.log(`history contains po=${found} items=${h2?.items?.length ?? 0}`);
  } else {
    console.log("instant POST skipped (set LIVE_INSTANT_POST=1 when eligible)");
  }
}

void main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
