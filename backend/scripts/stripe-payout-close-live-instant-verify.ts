/**
 * Read-only verification of the latest Employee Instant TEST payout (no new Stripe write).
 */
import "dotenv/config";
import "../src/loadEnv.js";
import { prisma } from "../src/prisma.js";
import { getStripeClient } from "../src/services/stripe.service.js";

const TAG = "p26_1786691378148";
const LUCA_EMAIL = `luca.${TAG}@caretip-test.local`;
const RENDER = "https://caretip.onrender.com";
const ORIGIN = "https://caretip.de";
const PASSWORD = process.env.PHASE26_PASSWORD?.trim() || "Phase26E2E!23";

function suffix(id: string | null | undefined) {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 10 ? "(short)" : `…${s.slice(-8)}`;
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: LUCA_EMAIL }, select: { id: true } });
  const emp = user
    ? await prisma.employee.findFirst({
        where: { userId: user.id, isDeleted: false },
        select: { id: true, stripeAccount: { select: { stripeAccountId: true } } },
      })
    : null;
  if (!emp) {
    console.log("luca_missing");
    return;
  }
  const rows = await prisma.employeeInstantPayoutRequest.findMany({
    where: { employeeId: emp.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      amountCents: true,
      currency: true,
      status: true,
      stripePayoutId: true,
      idempotencyKey: true,
      createdAt: true,
    },
  });
  for (const row of rows) {
    console.log(
      `req ${suffix(row.id)} amount=${row.amountCents} ${row.currency} status=${row.status} po=${suffix(row.stripePayoutId)} created=${row.createdAt.toISOString()} key_prefix=${row.idempotencyKey.slice(0, 36)}`,
    );
  }
  const latest = rows[0];
  const acct = emp.stripeAccount?.stripeAccountId ?? "";
  const poId = latest?.stripePayoutId ?? "";
  if (latest && poId.startsWith("po_") && acct.startsWith("acct_")) {
    const stripe = getStripeClient();
    const payout = await stripe.payouts.retrieve(
      poId,
      { expand: ["balance_transaction", "destination"] },
      { stripeAccount: acct },
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
      `stripe livemode=${payout.livemode} amount=${payout.amount} currency=${payout.currency} method=${payout.method} status=${payout.status} dest=${suffix(dest)} acct=${suffix(acct)}`,
    );
    if (bt && "fee" in bt) console.log(`bt amount=${bt.amount} fee=${bt.fee} net=${bt.net} id=${suffix("id" in bt ? String(bt.id) : null)}`);
    const list = await stripe.payouts.list({ limit: 10 }, { stripeAccount: acct });
    const matches = list.data.filter((p) => p.id === poId);
    const instantCount = list.data.filter((p) => p.method === "instant" && p.amount === latest.amountCents).length;
    console.log(`list_matches_po=${matches.length} same_amount_instant_in_last10=${instantCount}`);
    const bizRow = await prisma.stripeConnectPayout.findFirst({
      where: { stripePayoutId: poId },
      select: { id: true },
    });
    console.log(`business_stripeConnectPayout=${bizRow ? "CONTAMINATED" : "none"}`);
    const sameKey = await prisma.employeeInstantPayoutRequest.count({
      where: { employeeId: emp.id, idempotencyKey: latest.idempotencyKey },
    });
    console.log(`db_rows_same_idempotency=${sameKey}`);
  }

  const signin = await fetch(`${RENDER}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-caretip-client": "1", Origin: ORIGIN },
    body: JSON.stringify({ email: LUCA_EMAIL, password: PASSWORD }),
  });
  const auth = (await signin.json()) as { token?: string };
  const hist = await fetch(`${RENDER}/api/me/employee-connect/stripe-payouts?take=20`, {
    headers: {
      "x-caretip-client": "1",
      Origin: ORIGIN,
      Authorization: `Bearer ${auth.token ?? ""}`,
    },
  });
  const body = (await hist.json()) as {
    stripeReadable?: boolean;
    items?: Array<{ stripePayoutId?: string | null; amountCents?: number; method?: string; status?: string }>;
  };
  const found = body.items?.some((it) => it.stripePayoutId === poId);
  console.log(
    `history GET=${hist.status} readable=${body.stripeReadable} items=${body.items?.length ?? 0} contains_po=${found}`,
  );
  const top = body.items?.[0];
  if (top) {
    console.log(
      `history_top po=${suffix(top.stripePayoutId)} amount=${top.amountCents} method=${top.method} status=${top.status}`,
    );
  }
}

void main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
