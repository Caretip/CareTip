/**
 * File-backed Stripe test doubles shared by several processes (one "Stripe" per state dir).
 * Never calls Stripe. Import only after completeIsolatedPostgresBootstrap().
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type Stripe from "stripe";

type JsonlRow = Record<string, unknown>;

export function readJsonl(path: string): JsonlRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as JsonlRow);
}

function appendJsonl(path: string, row: JsonlRow): void {
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const reversalCallsPath = (stateDir: string) => join(stateDir, "reversal-calls.jsonl");
export const reversalsPath = (stateDir: string) => join(stateDir, "reversals.jsonl");
export const instantCreatesPath = (stateDir: string) => join(stateDir, "instant-creates.jsonl");

/** Effective (Stripe-side) reversed amount for a transfer. */
export function mockAmountReversed(stateDir: string, transferId: string): number {
  return readJsonl(reversalsPath(stateDir))
    .filter((r) => r.transferId === transferId)
    .reduce((sum, r) => sum + Number(r.amount), 0);
}

export const INSTANT_NET_CENTS = 5000;
const INSTANT_DESTINATION = "ba_multi_instance_1";

export async function installMultiInstanceStripeMocks(
  stateDir: string,
  opts: { crashAfterReversal?: boolean } = {},
): Promise<void> {
  const release = await import("../../src/services/employeeTipRelease.service.js");
  const instant = await import("../../src/services/stripeConnectInstantPayout.service.js");
  const recon = await import("../../src/services/stripeConnectPayoutReconciliation.service.js");

  release.__setEmployeeTipTransferRetrieveFnForTests(async (transferId) => ({
    amount_reversed: mockAmountReversed(stateDir, transferId),
  }));
  release.__setEmployeeTipTransferReversalFnForTests(async (transferId, params, options) => {
    const key = String(options.idempotencyKey ?? "");
    appendJsonl(reversalCallsPath(stateDir), { transferId, key, amount: params.amount, pid: process.pid });
    await sleep(60 + Math.floor(Math.random() * 60));
    const replay = readJsonl(reversalsPath(stateDir)).find((r) => r.key === key);
    if (!replay) appendJsonl(reversalsPath(stateDir), { transferId, key, amount: params.amount });
    if (opts.crashAfterReversal) {
      // Stripe accepted the reversal; the process dies before the DB transaction commits.
      process.exit(137);
    }
    return { id: `trr_mock_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`, amount: Number(params.amount) };
  });

  instant.__setInstantPayoutStripeFnsForTests({
    retrieveAccount: async () => ({ country: "DE", payouts_enabled: true, charges_enabled: true }),
    retrieveBalance: async () =>
      ({
        object: "balance",
        available: [{ amount: INSTANT_NET_CENTS * 2, currency: "eur" }],
        pending: [{ amount: 0, currency: "eur" }],
        instant_available: [
          {
            amount: Math.round(INSTANT_NET_CENTS / 0.975),
            currency: "eur",
            net_available: [
              { amount: INSTANT_NET_CENTS, destination: INSTANT_DESTINATION, source_types: { card: INSTANT_NET_CENTS } },
            ],
          },
        ],
      }) as unknown as Stripe.Balance,
    listExternalAccounts: async () =>
      ({
        object: "list",
        data: [
          {
            id: INSTANT_DESTINATION,
            object: "bank_account",
            last4: "1234",
            available_payout_methods: ["standard", "instant"],
          },
        ],
        has_more: false,
      }) as unknown as Stripe.ApiList<Stripe.BankAccount | Stripe.Card>,
    // Stripe idempotency: a concurrent request with an in-flight key fails with
    // idempotency_key_in_use; a later one replays the stored result.
    createInstantPayout: async (args) => {
      const keyHash = createHash("sha256").update(args.idempotencyKey).digest("hex").slice(0, 24);
      const lockPath = join(stateDir, `instant-${keyHash}.lock`);
      const resultPath = join(stateDir, `instant-${keyHash}.json`);
      try {
        writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      } catch {
        if (existsSync(resultPath)) return JSON.parse(readFileSync(resultPath, "utf8")) as Stripe.Payout;
        throw Object.assign(new Error("idempotency key in use (mock)"), { code: "idempotency_key_in_use" });
      }
      appendJsonl(instantCreatesPath(stateDir), { keyHash, amount: args.amountCents, pid: process.pid });
      await sleep(400);
      const payout = {
        id: `po_mock_${keyHash}`,
        object: "payout",
        amount: args.amountCents,
        currency: args.currency,
        status: "pending",
        method: "instant",
        type: "bank_account",
        created: Math.floor(Date.now() / 1000),
        arrival_date: Math.floor(Date.now() / 1000),
      } as unknown as Stripe.Payout;
      writeFileSync(resultPath, JSON.stringify(payout));
      return payout;
    },
  });

  recon.__setListPayoutBalanceTransactionsFnForTests(async () => null);
  recon.__setListPayoutBalanceTransactionPageFnForTests(async () => null);
  recon.__setRetrievePayoutForReconFnForTests(async () => null);
}
