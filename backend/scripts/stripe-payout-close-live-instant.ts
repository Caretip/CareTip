/**
 * TEST 2 only — Employee Instant POST on Render using a known Phase26 TEST employee
 * whose Instant net is already >= €30. Stripe TEST only.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";
import { EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS } from "../src/config/employeeInstantPayout.js";

const RENDER = "https://caretip.onrender.com";
const ORIGIN = "https://caretip.de";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";
const TAG = "p26_1786691378148";
const CANDIDATES = ["luca", "maria", "sam", "sarah", "noah", "lena", "omar", "iris", "jordan"].map(
  (k) => `${k}.${TAG}@caretip-test.local`,
);

function suffix(id: string | null | undefined) {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}

async function renderJson(path: string, init: RequestInit & { token?: string } = {}) {
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
    json = { raw: text.slice(0, 160) };
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
  return { status: res.status, token };
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
    console.log("FAIL not_test_stripe_key");
    process.exit(1);
  }
  const stripe = getStripeClient();
  let chosen: { local: string; token: string; acct: string; net: number } | null = null;

  for (const email of CANDIDATES) {
    const local = email.split("@")[0] ?? email;
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      console.log(`no_user ${local}`);
      continue;
    }
    const emp = await prisma.employee.findFirst({
      where: { userId: user.id, isDeleted: false },
      select: { stripeAccount: { select: { stripeAccountId: true } } },
    });
    const acct = emp?.stripeAccount?.stripeAccountId ?? "";
    if (!acct.startsWith("acct_")) {
      console.log(`no_acct ${local}`);
      continue;
    }
    const auth = await signin(email);
    const get = await renderJson("/api/me/employee-connect/instant-payout", { token: auth.token });
    const body = get.json as {
      eligible?: boolean;
      reason?: string;
      instantAvailableNetCents?: number;
      minPayoutCents?: number;
    } | null;
    console.log(
      `scan local=${local} auth=${auth.status} get=${get.status} eligible=${body?.eligible} reason=${body?.reason} net=${body?.instantAvailableNetCents} min=${body?.minPayoutCents} acct=${suffix(acct)}`,
    );
    if (
      auth.status === 200 &&
      body?.eligible === true &&
      Number(body.instantAvailableNetCents ?? 0) >= EMPLOYEE_INSTANT_PAYOUT_MIN_CENTS
    ) {
      chosen = { local, token: auth.token, acct, net: Number(body.instantAvailableNetCents) };
      break;
    }
  }

  if (!chosen) {
    console.log("TEST2 BLOCKED — ENVIRONMENT no known-password employee eligible");
    return;
  }

  const guest = await renderJson("/api/me/employee-connect/instant-payout", {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: "guest_x" }),
  });
  const mgr = await signin(`mgr_${TAG}@caretip-test.local`);
  const mgrPost = await renderJson("/api/me/employee-connect/instant-payout", {
    token: mgr.token,
    method: "POST",
    body: JSON.stringify({ idempotencyKey: `mgr_x_${Date.now()}` }),
  });
  const steer = await renderJson("/api/me/employee-connect/instant-payout", {
    token: chosen.token,
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `steer_x_${Date.now()}`,
      amount: 99999,
      destination: "acct_ATTACKER",
      employeeId: "other",
      businessId: "other",
    }),
  });
  console.log(
    `sec guestPost=${guest.status} mgrPost=${mgrPost.status} steer=${steer.status} actor=${chosen.local} net=${chosen.net}`,
  );

  const key = `close_gaps_instant_${Date.now()}`;
  const first = await renderJson("/api/me/employee-connect/instant-payout", {
    token: chosen.token,
    method: "POST",
    body: JSON.stringify({ idempotencyKey: key }),
  });
  const second = await renderJson("/api/me/employee-connect/instant-payout", {
    token: chosen.token,
    method: "POST",
    body: JSON.stringify({ idempotencyKey: key }),
  });
  const p1 = (first.json as { payout?: Record<string, string | number> } | null)?.payout ?? {};
  const p2 = (second.json as { payout?: { stripePayoutId?: string } } | null)?.payout ?? {};
  const poId = String(p1.stripePayoutId ?? "");
  console.log(
    `TEST2 POST first=${first.status} po=${suffix(poId)} amount=${p1.amountCents} currency=${p1.currency} method=${p1.method} status=${p1.status}`,
  );
  console.log(
    `TEST2 replay=${second.status} po=${suffix(p2.stripePayoutId)} same=${poId === (p2.stripePayoutId ?? "")}`,
  );

  if (poId.startsWith("po_")) {
    const payout = await stripe.payouts.retrieve(
      poId,
      { expand: ["balance_transaction", "destination"] },
      { stripeAccount: chosen.acct },
    );
    const bt =
      payout.balance_transaction && typeof payout.balance_transaction === "object"
        ? payout.balance_transaction
        : null;
    const dest =
      typeof payout.destination === "string"
        ? payout.destination
        : payout.destination && typeof payout.destination === "object"
          ? (payout.destination as { id?: string }).id
          : null;
    console.log(
      `TEST2 stripe livemode=${payout.livemode} amount=${payout.amount} currency=${payout.currency} method=${payout.method} status=${payout.status} dest=${suffix(dest)} acct=${suffix(chosen.acct)}`,
    );
    if (bt && "fee" in bt) {
      console.log(`TEST2 bt amount=${bt.amount} fee=${bt.fee} net=${bt.net}`);
    }
    const list = await stripe.payouts.list({ limit: 15 }, { stripeAccount: chosen.acct });
    console.log(`TEST2 stripe_list_matches=${list.data.filter((p) => p.id === poId).length}`);
    const bizRow = await prisma.stripeConnectPayout.findFirst({
      where: { stripePayoutId: poId },
      select: { id: true },
    });
    console.log(`TEST2 business_stripeConnectPayout=${bizRow ? "CONTAMINATED" : "none"}`);
  }

  const hist = await renderJson("/api/me/employee-connect/stripe-payouts?take=20", { token: chosen.token });
  const items =
    (hist.json as { items?: Array<{ stripePayoutId?: string }> } | null)?.items ?? [];
  console.log(
    `TEST2 history GET=${hist.status} contains=${items.some((it) => it.stripePayoutId === poId)} items=${items.length}`,
  );
  const jordan = await signin(`jordan.${TAG}@caretip-test.local`);
  const jh = await renderJson("/api/me/employee-connect/stripe-payouts?take=20", { token: jordan.token });
  const jItems = (jh.json as { items?: Array<{ stripePayoutId?: string }> } | null)?.items ?? [];
  console.log(`jordan history items=${jItems.length} leaked=${jItems.some((it) => it.stripePayoutId === poId)}`);
  console.log(
    `TEST2 RESULT ${first.status === 200 && poId.startsWith("po_") && poId === (p2.stripePayoutId ?? poId) ? "PASS" : "FAIL"}`,
  );
}

void main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
