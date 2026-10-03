/**
 * Read-only Stripe connected-account payout list for the authenticated employee.
 * These are Stripe → bank/card payouts, not CareTip SCTs.
 */
import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import { resolveActiveEmployeeForConnect } from "./employeeStripeConnect.service.js";
import { sanitizePayoutFailureMessage } from "./stripeConnectPayout.service.js";
import { resolveEmployeePayoutInitiationKinds } from "./connectPayoutDisplayEnrichment.service.js";

export type EmployeeStripeBankPayoutItem = {
  /** Stripe payout id (`po_…`) when Stripe returns one. Never invented. */
  stripePayoutId: string | null;
  createdAt: string;
  /** Stripe `arrival_date` when present. Never invented. */
  arrivalDate: string | null;
  amountCents: number;
  currency: string;
  status: string;
  method: "instant" | "standard" | "unknown";
  /** Last four of the payout destination when Stripe expands it. Never a full account number. */
  destinationLast4: string | null;
  payoutType: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  initiationKind: "caretip_scheduled" | "caretip_instant" | null;
};

type ListPayoutsFn = (stripeAccountId: string, limit: number) => Promise<Stripe.ApiList<Stripe.Payout>>;

let listPayoutsFn: ListPayoutsFn | null = null;

export function __setEmployeeStripePayoutListFnForTests(fn: ListPayoutsFn | null): void {
  listPayoutsFn = fn;
}

function methodOf(payout: Stripe.Payout): EmployeeStripeBankPayoutItem["method"] {
  const m = String(payout.method ?? "").toLowerCase();
  if (m === "instant") return "instant";
  if (m === "standard") return "standard";
  return "unknown";
}

function stripePayoutIdOf(payout: Stripe.Payout): string | null {
  const id = typeof payout.id === "string" ? payout.id.trim() : "";
  return id.startsWith("po_") ? id : null;
}

function destinationLast4Of(payout: Stripe.Payout): string | null {
  const dest = payout.destination;
  if (!dest || typeof dest === "string") return null;
  if ("deleted" in dest && dest.deleted) return null;
  const last4 = "last4" in dest ? dest.last4 : null;
  return typeof last4 === "string" && /^\d{2,4}$/.test(last4) ? last4.slice(-4) : null;
}

function arrivalDateOf(payout: Stripe.Payout): string | null {
  const arrival = payout.arrival_date;
  if (typeof arrival !== "number" || !Number.isFinite(arrival) || arrival <= 0) return null;
  return new Date(arrival * 1000).toISOString();
}

export async function listEmployeeStripeBankPayoutsForUser(
  userId: string,
  opts?: { take?: number },
): Promise<{
  items: EmployeeStripeBankPayoutItem[];
  stripeReadable: boolean;
  bankPayoutSchedule: string | null;
}> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const account = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
    select: { stripeAccountId: true, bankPayoutSchedule: true },
  });
  const stripeAccountId = account?.stripeAccountId?.trim() ?? "";
  if (!stripeAccountId.startsWith("acct_")) {
    return { items: [], stripeReadable: false, bankPayoutSchedule: null };
  }
  if (!isStripeConfigured() && !listPayoutsFn) {
    return { items: [], stripeReadable: false, bankPayoutSchedule: account?.bankPayoutSchedule ?? null };
  }

  const take = Number.isInteger(opts?.take) ? Math.min(50, Math.max(1, opts!.take!)) : 20;
  try {
    const list = listPayoutsFn
      ? await listPayoutsFn(stripeAccountId, take)
      : await getStripeClient().payouts.list(
          { limit: take, expand: ["data.destination"] },
          { stripeAccount: stripeAccountId },
        );
    const initiationByPo = await resolveEmployeePayoutInitiationKinds(
      actor.employeeId,
      (list.data ?? []).map((p) => stripePayoutIdOf(p) ?? ""),
    );
    const items: EmployeeStripeBankPayoutItem[] = (list.data ?? []).map((payout) => {
      const poId = stripePayoutIdOf(payout);
      return {
        stripePayoutId: poId,
        createdAt: new Date((payout.created ?? 0) * 1000).toISOString(),
        arrivalDate: arrivalDateOf(payout),
        amountCents: Number.isInteger(payout.amount) ? payout.amount : 0,
        currency: String(payout.currency ?? "eur").toLowerCase(),
        status: String(payout.status ?? "unknown"),
        method: methodOf(payout),
        destinationLast4: destinationLast4Of(payout),
        payoutType: typeof payout.type === "string" ? payout.type : null,
        failureCode: typeof payout.failure_code === "string" ? payout.failure_code : null,
        failureMessage: sanitizePayoutFailureMessage(payout.failure_message),
        initiationKind: poId ? (initiationByPo.get(poId) ?? null) : null,
      };
    });
    void persistObservedEmployeePayouts(actor.employeeId, stripeAccountId, list.data ?? []);
    return {
      items,
      stripeReadable: true,
      bankPayoutSchedule: account?.bankPayoutSchedule ?? null,
    };
  } catch (err) {
    logServerError("employeeStripeBankPayouts.list", err, { userId });
    throw new StripeConnectError(
      "Could not load Stripe bank payout history.",
      "EMPLOYEE_STRIPE_PAYOUT_LIST_FAILED",
      502,
    );
  }
}

function persistObservedEmployeePayouts(
  employeeId: string,
  stripeAccountId: string,
  payouts: Stripe.Payout[],
): void {
  void (async () => {
    const { persistEmployeePayoutFromStripeObject } = await import("./employeeStripePayout.service.js");
    for (const payout of payouts) {
      try {
        await persistEmployeePayoutFromStripeObject({ employeeId, stripeAccountId, payout });
      } catch (err) {
        logServerError("employeeStripeBankPayouts.observe", err, { employeeId });
      }
    }
  })();
}
