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

export type EmployeeStripeBankPayoutItem = {
  /** Stripe payout id (`po_…`) when Stripe returns one. Never invented. */
  stripePayoutId: string | null;
  createdAt: string;
  amountCents: number;
  currency: string;
  status: string;
  method: "instant" | "standard" | "unknown";
  /** Last four of the payout destination when Stripe expands it. Never a full account number. */
  destinationLast4: string | null;
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

export async function listEmployeeStripeBankPayoutsForUser(
  userId: string,
  opts?: { take?: number },
): Promise<{ items: EmployeeStripeBankPayoutItem[]; stripeReadable: boolean }> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const account = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
    select: { stripeAccountId: true },
  });
  const stripeAccountId = account?.stripeAccountId?.trim() ?? "";
  if (!stripeAccountId.startsWith("acct_")) {
    return { items: [], stripeReadable: false };
  }
  if (!isStripeConfigured() && !listPayoutsFn) {
    return { items: [], stripeReadable: false };
  }

  const take = Number.isInteger(opts?.take) ? Math.min(50, Math.max(1, opts!.take!)) : 20;
  try {
    const list = listPayoutsFn
      ? await listPayoutsFn(stripeAccountId, take)
      : await getStripeClient().payouts.list(
          { limit: take, expand: ["data.destination"] },
          { stripeAccount: stripeAccountId },
        );
    const items: EmployeeStripeBankPayoutItem[] = (list.data ?? []).map((payout) => ({
      stripePayoutId: stripePayoutIdOf(payout),
      createdAt: new Date((payout.created ?? 0) * 1000).toISOString(),
      amountCents: Number.isInteger(payout.amount) ? payout.amount : 0,
      currency: String(payout.currency ?? "eur").toLowerCase(),
      status: String(payout.status ?? "unknown"),
      method: methodOf(payout),
      destinationLast4: destinationLast4Of(payout),
    }));
    return { items, stripeReadable: true };
  } catch (err) {
    logServerError("employeeStripeBankPayouts.list", err, { userId });
    throw new StripeConnectError(
      "Could not load Stripe bank payout history.",
      "EMPLOYEE_STRIPE_PAYOUT_LIST_FAILED",
      502,
    );
  }
}
