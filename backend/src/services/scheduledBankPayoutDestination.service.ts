/**
 * Shared validation for CareTip-initiated scheduled standard Connect payouts.
 * Resolves the default external account for a currency and verifies `standard` is supported.
 */
import type Stripe from "stripe";
import { ScheduledPayoutFailureClassification } from "@prisma/client";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { logServerError } from "../utils/httpErrors.js";
import type { StripePayoutCreateDiagnostics } from "./scheduledBankPayoutRecovery.service.js";
import { sanitizeScheduledPayoutFailureMessage } from "./scheduledBankPayoutRecovery.service.js";

export type ScheduledPayoutExternalKind = "bank_account" | "card";

export type ResolvedScheduledPayoutDestination = {
  kind: ScheduledPayoutExternalKind;
  /** Masked for logs (e.g. ba_abc…1234). */
  maskedId: string;
  supportsStandard: boolean;
  supportsInstant: boolean;
  defaultForCurrency: boolean;
};

type ListExternalAccountsFn = (
  stripeAccountId: string,
) => Promise<Stripe.ApiList<Stripe.BankAccount | Stripe.Card>>;

let listExternalAccountsFn: ListExternalAccountsFn | null = null;

export function __setScheduledBankPayoutDestinationStripeFnsForTests(fns: {
  listExternalAccounts?: ListExternalAccountsFn | null;
}): void {
  listExternalAccountsFn = fns.listExternalAccounts === undefined ? listExternalAccountsFn : fns.listExternalAccounts;
}

export function __resetScheduledBankPayoutDestinationStripeFnsForTests(): void {
  listExternalAccountsFn = null;
}

function maskStripeId(id: string): string {
  const t = id.trim();
  if (t.length <= 10) return "ext_…";
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export function externalAccountKind(
  account: Stripe.BankAccount | Stripe.Card,
): ScheduledPayoutExternalKind {
  return account.object === "card" ? "card" : "bank_account";
}

export function externalAccountCurrency(account: Stripe.BankAccount | Stripe.Card): string {
  const raw = (account as Stripe.BankAccount).currency;
  return String(raw ?? "").toLowerCase().slice(0, 8);
}

export function readAvailablePayoutMethods(
  account: Stripe.BankAccount | Stripe.Card,
): string[] | null {
  const methods = (account as Stripe.BankAccount).available_payout_methods;
  if (!Array.isArray(methods)) return null;
  return methods.map((m) => String(m).toLowerCase());
}

export function destinationSupportsStandardPayout(
  account: Stripe.BankAccount | Stripe.Card,
): boolean {
  const methods = readAvailablePayoutMethods(account);
  if (methods === null) return false;
  return methods.includes("standard");
}

export function destinationSupportsInstantPayout(
  account: Stripe.BankAccount | Stripe.Card,
): boolean {
  const methods = readAvailablePayoutMethods(account);
  if (methods === null) return false;
  return methods.includes("instant");
}

export type ResolveDefaultDestinationResult =
  | { kind: "resolved"; account: Stripe.BankAccount | Stripe.Card }
  | { kind: "ambiguous"; reason: string }
  | { kind: "missing"; reason: string };

/**
 * Stripe uses the external account marked default_for_currency for the payout currency.
 * Does not fall back to the first listed account when no default is marked.
 */
export function resolveDefaultExternalAccountForCurrency(
  accounts: Array<Stripe.BankAccount | Stripe.Card>,
  currency: string,
): ResolveDefaultDestinationResult {
  const want = currency.toLowerCase().slice(0, 8);
  const forCurrency = accounts.filter((a) => externalAccountCurrency(a) === want);
  if (forCurrency.length === 0) {
    return { kind: "missing", reason: "no_external_account_for_currency" };
  }
  const defaults = forCurrency.filter((a) => (a as Stripe.BankAccount).default_for_currency === true);
  if (defaults.length > 1) {
    return { kind: "ambiguous", reason: "multiple_default_for_currency" };
  }
  if (defaults.length === 1) {
    return { kind: "resolved", account: defaults[0]! };
  }
  return { kind: "ambiguous", reason: "no_default_for_currency" };
}

export function buildScheduledPayoutDestinationDiagnostics(args: {
  failureCode:
    | "payout_destination_incompatible"
    | "payout_destination_ambiguous"
    | "payout_destination_missing"
    | "payout_destination_lookup_failed";
  message: string;
}): StripePayoutCreateDiagnostics {
  return {
    stripeErrorCode: null,
    stripeErrorType: null,
    stripeHttpStatus: null,
    stripeRequestId: null,
    failureMessage: sanitizeScheduledPayoutFailureMessage(args.message),
    failureClassification: ScheduledPayoutFailureClassification.permanent,
    failureCode: args.failureCode,
  };
}

export function describeResolvedDestination(
  account: Stripe.BankAccount | Stripe.Card,
): ResolvedScheduledPayoutDestination {
  return {
    kind: externalAccountKind(account),
    maskedId: maskStripeId(account.id),
    supportsStandard: destinationSupportsStandardPayout(account),
    supportsInstant: destinationSupportsInstantPayout(account),
    defaultForCurrency: (account as Stripe.BankAccount).default_for_currency === true,
  };
}

async function listExternalAccounts(
  stripeAccountId: string,
): Promise<Stripe.ApiList<Stripe.BankAccount | Stripe.Card>> {
  if (listExternalAccountsFn) return listExternalAccountsFn(stripeAccountId);
  return getStripeClient().accounts.listExternalAccounts(stripeAccountId, { limit: 100 });
}

export type ValidateScheduledStandardPayoutDestinationResult =
  | { ok: true; destination: ResolvedScheduledPayoutDestination }
  | { ok: false; diagnostics: StripePayoutCreateDiagnostics };

export async function validateScheduledStandardPayoutDestination(args: {
  stripeAccountId: string;
  currency: string;
}): Promise<ValidateScheduledStandardPayoutDestinationResult> {
  const currency = args.currency.toLowerCase().slice(0, 8);
  const stripeAccountId = args.stripeAccountId.trim();
  if (!stripeAccountId.startsWith("acct_")) {
    return {
      ok: false,
      diagnostics: buildScheduledPayoutDestinationDiagnostics({
        failureCode: "payout_destination_missing",
        message: "Connect account is not configured for scheduled bank payouts.",
      }),
    };
  }

  if (!isStripeConfigured() && !listExternalAccountsFn) {
    return {
      ok: false,
      diagnostics: buildScheduledPayoutDestinationDiagnostics({
        failureCode: "payout_destination_lookup_failed",
        message: "Stripe is not configured.",
      }),
    };
  }

  let externals: Stripe.ApiList<Stripe.BankAccount | Stripe.Card>;
  try {
    externals = await listExternalAccounts(stripeAccountId);
  } catch (err) {
    logServerError("scheduledBankPayoutDestination.listExternalAccounts", err, {
      accountSuffix: stripeAccountId.slice(-6),
    });
    return {
      ok: false,
      diagnostics: buildScheduledPayoutDestinationDiagnostics({
        failureCode: "payout_destination_lookup_failed",
        message: "Could not load payout destination from Stripe.",
      }),
    };
  }

  const resolved = resolveDefaultExternalAccountForCurrency(externals.data ?? [], currency);
  if (resolved.kind === "missing") {
    return {
      ok: false,
      diagnostics: buildScheduledPayoutDestinationDiagnostics({
        failureCode: "payout_destination_missing",
        message:
          "No payout destination is configured for this currency. Add a bank account in Stripe payout settings.",
      }),
    };
  }
  if (resolved.kind === "ambiguous") {
    return {
      ok: false,
      diagnostics: buildScheduledPayoutDestinationDiagnostics({
        failureCode: "payout_destination_ambiguous",
        message:
          "Payout destination could not be determined safely. Set one default bank account for this currency in Stripe.",
      }),
    };
  }

  const destination = describeResolvedDestination(resolved.account);
  if (!destinationSupportsStandardPayout(resolved.account)) {
    const kindLabel = destination.kind === "card" ? "debit card" : "payout destination";
    return {
      ok: false,
      diagnostics: buildScheduledPayoutDestinationDiagnostics({
        failureCode: "payout_destination_incompatible",
        message: `Scheduled bank payouts require a bank account that supports standard transfers. The default ${kindLabel} does not support standard payouts. Add or select a compatible bank account in Stripe.`,
      }),
    };
  }

  return { ok: true, destination };
}
