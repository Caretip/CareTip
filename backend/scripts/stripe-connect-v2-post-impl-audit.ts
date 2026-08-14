/**
 * Read-only Stripe Connect V2 post-implementation audit.
 * Never creates accounts, never mutates payouts, never prints secrets.
 */
import "dotenv/config";
import "../src/loadEnv.js";
import Stripe from "stripe";
import { prisma } from "../src/prisma.js";

function suffix(id: string | null | undefined): string {
  const s = (id ?? "").trim();
  if (!s) return "(none)";
  return s.length <= 8 ? "(short)" : `…${s.slice(-8)}`;
}

function keyMode(raw: string | undefined): { present: boolean; mode: "TEST" | "LIVE" | "UNKNOWN" | "MISSING" } {
  const v = raw?.trim() ?? "";
  if (!v) return { present: false, mode: "MISSING" };
  if (v.startsWith("sk_test_")) return { present: true, mode: "TEST" };
  if (v.startsWith("sk_live_")) return { present: true, mode: "LIVE" };
  if (v.startsWith("pk_test_") || v.startsWith("rk_test_")) return { present: true, mode: "TEST" };
  if (v.startsWith("pk_live_") || v.startsWith("rk_live_")) return { present: true, mode: "LIVE" };
  if (v.startsWith("whsec_")) return { present: true, mode: "UNKNOWN" };
  return { present: true, mode: "UNKNOWN" };
}

async function main(): Promise<void> {
  const secret = process.env.STRIPE_SECRET_KEY;
  const webhook = process.env.STRIPE_WEBHOOK_SECRET;
  const secretInfo = keyMode(secret);
  const webhookInfo = keyMode(webhook);

  console.log("=== ENV (secrets redacted) ===");
  console.log(`STRIPE_SECRET_KEY: ${secretInfo.present ? "PRESENT" : "MISSING"} mode=${secretInfo.mode}`);
  console.log(
    `STRIPE_WEBHOOK_SECRET: ${webhookInfo.present ? "PRESENT" : "MISSING"} mode=${webhookInfo.mode}`,
  );
  console.log(`FRONTEND_URL: ${process.env.FRONTEND_URL?.trim() ? "PRESENT" : "MISSING"}`);
  console.log(`STRIPE_ACCOUNTS_V2_API_VERSION: ${process.env.STRIPE_ACCOUNTS_V2_API_VERSION?.trim() || "(code default 2026-07-29.dahlia)"}`);

  if (!secretInfo.present || secretInfo.mode !== "TEST") {
    console.log("STOP: refusing live-mode or missing secret. No Stripe calls.");
    process.exit(secretInfo.mode === "LIVE" ? 2 : 1);
  }

  const stripe = new Stripe(secret!.trim());

  console.log("\n=== PLATFORM ACCOUNT ===");
  const platform = await stripe.accounts.retrieve();
  console.log(`platform_id_suffix: ${suffix(platform.id)}`);
  console.log(`livemode: ${platform.livemode === true ? "LIVE" : "TEST"}`);
  console.log(`country: ${platform.country ?? "(unset)"}`);
  console.log(`charges_enabled: ${platform.charges_enabled === true}`);
  console.log(`payouts_enabled: ${platform.payouts_enabled === true}`);
  const bizName =
    platform.business_profile?.name ||
    platform.settings?.dashboard?.display_name ||
    "(no display name on platform object)";
  console.log(`display_name: ${bizName}`);

  console.log("\n=== WEBHOOK ENDPOINTS ===");
  const hooks = await stripe.webhookEndpoints.list({ limit: 20 });
  console.log(`count: ${hooks.data.length}`);
  for (const h of hooks.data) {
    const urlHost = (() => {
      try {
        return new URL(h.url).host;
      } catch {
        return "(invalid-url)";
      }
    })();
    const hasConnect = (h.enabled_events ?? []).some(
      (e) => e === "*" || e.startsWith("account.") || e.startsWith("payout.") || e === "checkout.session.completed",
    );
    console.log(
      `- status=${h.status} api_version=${h.api_version ?? "(account default)"} host=${urlHost} livemode=${h.livemode === true} events=${JSON.stringify(h.enabled_events)}`,
    );
  }

  console.log("\n=== CONNECTED ACCOUNTS (list, no create) ===");
  const listed: Stripe.Account[] = [];
  for await (const acct of stripe.accounts.list({ limit: 100 })) {
    listed.push(acct);
  }
  console.log(`listed_count: ${listed.length}`);

  const retrieved: Stripe.Account[] = [];
  for (const a of listed) {
    const full = await stripe.accounts.retrieve(a.id);
    retrieved.push(full);
    const individualName = [full.individual?.first_name, full.individual?.last_name].filter(Boolean).join(" ");
    const name = full.business_profile?.name || full.settings?.dashboard?.display_name || full.email || "(unnamed)";
    console.log(
      `- suffix=${suffix(full.id)} name=${name} individual=${individualName || "(none)"} charges=${full.charges_enabled === true} payouts=${full.payouts_enabled === true} details=${full.details_submitted === true} type=${full.type ?? "(none)"}`,
    );
  }

  console.log("\n=== V2 CORE ACCOUNTS (GET /v2/core/accounts, no create) ===");
  let v2Rows: Array<{ id?: string; display_name?: string; dashboard?: string; applied_configurations?: string[] }> = [];
  try {
    const v2 = (await stripe.rawRequest(
      "GET",
      "/v2/core/accounts?limit=20",
      null,
      { apiVersion: "2026-07-29.dahlia" },
    )) as { data?: Array<{ id?: string; display_name?: string; dashboard?: string; applied_configurations?: string[] }> };
    v2Rows = Array.isArray(v2.data) ? v2.data : [];
    console.log(`v2_listed_count: ${v2Rows.length}`);
    for (const row of v2Rows) {
      const id = typeof row.id === "string" ? row.id : "";
      console.log(
        `- suffix=${suffix(id)} display_name=${row.display_name ?? "(none)"} dashboard=${row.dashboard ?? "(none)"} configs=${(row.applied_configurations ?? []).join(",") || "(none)"}`,
      );
    }
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "error";
    const status = err && typeof err === "object" && "statusCode" in err ? String((err as { statusCode?: unknown }).statusCode) : "";
    console.log(`v2_list_failed code=${code} status=${status}`);
  }

  console.log("\n=== MARIE TESTERIN ===");
  const marie =
    retrieved.find((a) => {
      const individualName = [a.individual?.first_name, a.individual?.last_name].filter(Boolean).join(" ").toLowerCase();
      const blob = `${a.business_profile?.name ?? ""} ${a.email ?? ""} ${a.settings?.dashboard?.display_name ?? ""} ${individualName}`.toLowerCase();
      return blob.includes("marie") || blob.includes("testerin");
    }) ??
    retrieved.find((a) => {
      const v2 = v2Rows.find((r) => r.id === a.id);
      const configs = (v2?.applied_configurations ?? []).slice().sort().join(",");
      return configs === "customer,merchant" && a.charges_enabled === true && a.payouts_enabled === true;
    }) ??
    null;
  if (!marie) {
    console.log("NOT_FOUND_IN_ACCOUNTS_LIST");
  } else {
    const individualName = [marie.individual?.first_name, marie.individual?.last_name].filter(Boolean).join(" ");
    const v2Match = v2Rows.find((r) => r.id === marie.id);
    const configs = (v2Match?.applied_configurations ?? []).slice().sort().join(",");
    const named =
      `${marie.business_profile?.name ?? ""} ${individualName}`.toLowerCase().includes("marie") ||
      `${marie.business_profile?.name ?? ""} ${individualName}`.toLowerCase().includes("testerin");
    console.log(`found: YES suffix=${suffix(marie.id)} match=${named ? "name" : "customer+merchant_enabled_fixture"}`);
    console.log(`api_business_name: ${marie.business_profile?.name ?? "(none)"}`);
    console.log(`individual_name: ${individualName || "(none)"}`);
    console.log(`v2_configs: ${configs || "(none)"}`);
    const full = marie;
    console.log(`found: YES suffix=${suffix(full.id)}`);
    console.log(`type: ${full.type ?? "(none)"}`);
    console.log(`charges_enabled: ${full.charges_enabled === true}`);
    console.log(`payouts_enabled: ${full.payouts_enabled === true}`);
    console.log(`details_submitted: ${full.details_submitted === true}`);
    console.log(`disabled_reason: ${full.requirements?.disabled_reason ? "present" : "none"}`);
    console.log(`currently_due_count: ${(full.requirements?.currently_due ?? []).length}`);
    console.log(`capabilities.card_payments: ${full.capabilities?.card_payments ?? "(unset)"}`);
    console.log(`capabilities.transfers: ${full.capabilities?.transfers ?? "(unset)"}`);

    try {
      const bal = await stripe.balance.retrieve({ stripeAccount: full.id });
      const avail = bal.available.map((b) => `${b.amount} ${b.currency}`).join(", ") || "0";
      const pend = bal.pending.map((b) => `${b.amount} ${b.currency}`).join(", ") || "0";
      console.log(`available_balance: ${avail}`);
      console.log(`pending_balance: ${pend}`);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "error";
      console.log(`balance_retrieve: FAILED code=${code}`);
    }

    const payouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: full.id });
    console.log(`payout_objects_listed: ${payouts.data.length}`);
    for (const p of payouts.data) {
      console.log(
        `- payout suffix=${suffix(p.id)} status=${p.status} amount=${p.amount} ${p.currency} automatic=${p.automatic === true}`,
      );
    }

    const mapped = await prisma.business.findMany({
      where: { stripeAccountId: full.id },
      select: { id: true, name: true, stripeConnectStatus: true, stripeChargesEnabled: true, stripePayoutsEnabled: true },
    });
    console.log(`caretip_businesses_mapped: ${mapped.length}`);
    for (const b of mapped) {
      console.log(
        `- business suffix=${suffix(b.id)} name=${b.name} status=${b.stripeConnectStatus} charges=${b.stripeChargesEnabled} payouts=${b.stripePayoutsEnabled}`,
      );
    }
  }

  console.log("\n=== CARETIP DB CONNECT SNAPSHOT (no mutations) ===");
  const [bizWithAcct, bizTotal, payoutRows, txRows] = await Promise.all([
    prisma.business.count({ where: { stripeAccountId: { not: null } } }),
    prisma.business.count(),
    prisma.stripeConnectPayout.count(),
    prisma.transaction.count(),
  ]);
  console.log(`businesses_total: ${bizTotal}`);
  console.log(`businesses_with_stripeAccountId: ${bizWithAcct}`);
  console.log(`stripe_connect_payout_rows: ${payoutRows}`);
  console.log(`transaction_rows: ${txRows}`);

  const mappedAccounts = await prisma.business.findMany({
    where: { stripeAccountId: { not: null } },
    select: {
      id: true,
      name: true,
      stripeAccountId: true,
      stripeConnectStatus: true,
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
    },
    take: 50,
  });
  for (const b of mappedAccounts) {
    console.log(
      `- mapped business=${b.name} acct=${suffix(b.stripeAccountId)} status=${b.stripeConnectStatus} charges=${b.stripeChargesEnabled} payouts=${b.stripePayoutsEnabled}`,
    );
  }

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("AUDIT_SCRIPT_ERROR", msg.slice(0, 200));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
