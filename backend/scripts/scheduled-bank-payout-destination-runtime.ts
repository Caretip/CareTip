/**
 * Scheduled payout destination validation (mocked Stripe; no live payouts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type Stripe from "stripe";
import {
  ScheduledPayoutFailureClassification,
  StripeConnectScheduledPayoutRequestStatus,
} from "@prisma/client";
import {
  __resetScheduledBankPayoutDestinationStripeFnsForTests,
  __setScheduledBankPayoutDestinationStripeFnsForTests,
  destinationSupportsStandardPayout,
  resolveDefaultExternalAccountForCurrency,
  validateScheduledStandardPayoutDestination,
} from "../src/services/scheduledBankPayoutDestination.service.js";
import {
  canAttemptStripeCreateFromLedger,
  classifyStripePayoutError,
  diagnosticsToLedgerUpdate,
  extractStripePayoutCreateDiagnostics,
} from "../src/services/scheduledBankPayoutRecovery.service.js";

const servicesDir = join(dirname(fileURLToPath(import.meta.url)), "../src/services");
const sharedImport = 'from "./scheduledBankPayoutDestination.service.js"';
const validatorCall = "validateScheduledStandardPayoutDestination(";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function bankEur(args: {
  id: string;
  defaultForCurrency: boolean;
  methods: string[];
}): Stripe.BankAccount {
  return {
    id: args.id,
    object: "bank_account",
    currency: "eur",
    default_for_currency: args.defaultForCurrency,
    available_payout_methods: args.methods,
  } as Stripe.BankAccount;
}

function cardEur(args: {
  id: string;
  defaultForCurrency: boolean;
  methods: string[];
}): Stripe.Card {
  return {
    id: args.id,
    object: "card",
    currency: "eur",
    default_for_currency: args.defaultForCurrency,
    available_payout_methods: args.methods,
  } as Stripe.Card;
}

for (const file of ["employeeScheduledBankPayout.service.ts", "businessScheduledBankPayout.service.ts"]) {
  const src = readFileSync(join(servicesDir, file), "utf8");
  assert(src.includes(sharedImport) && src.includes(validatorCall), `${file} uses shared destination validator`);
}

// Default selection: only default_for_currency, not first in list
const multi = resolveDefaultExternalAccountForCurrency(
  [
    cardEur({ id: "card_0037", defaultForCurrency: true, methods: ["instant"] }),
    bankEur({ id: "ba_3000", defaultForCurrency: false, methods: ["standard", "instant"] }),
  ],
  "eur",
);
assert(multi.kind === "resolved" && multi.account.id === "card_0037", "default card wins over bank");

// Instant-eligible bank without standard → not assumed compatible
assert(
  !destinationSupportsStandardPayout(
    bankEur({ id: "ba_x", defaultForCurrency: true, methods: ["instant"] }),
  ),
  "instant-only bank does not imply standard",
);

// Debit card default without standard blocked before create
__setScheduledBankPayoutDestinationStripeFnsForTests({
  listExternalAccounts: async () => ({
    object: "list",
    data: [cardEur({ id: "card_0037", defaultForCurrency: true, methods: ["instant"] })],
    has_more: false,
    url: "/v1/accounts/acct_test/external_accounts",
  }),
});
const blockedCard = await validateScheduledStandardPayoutDestination({
  stripeAccountId: "acct_test_charline",
  currency: "eur",
});
assert(!blockedCard.ok && blockedCard.diagnostics.failureCode === "payout_destination_incompatible", "card blocked");
assert(
  blockedCard.diagnostics.failureClassification === ScheduledPayoutFailureClassification.permanent,
  "incompatible permanent",
);
const blockedLedger = diagnosticsToLedgerUpdate(blockedCard.diagnostics, 1);
assert(blockedLedger.nextRetryAt === null && blockedLedger.blockedReason === "permanent_failure", "no auto retry");
const permanentGate = canAttemptStripeCreateFromLedger({
  id: "led_dest",
  scheduleWindowKey: "2026-10-08T07:00:00.000Z",
  idempotencyKey: "key",
  amountCents: 9802,
  currency: "eur",
  stripePayoutId: null,
  failureCode: blockedCard.diagnostics.failureCode,
  attemptCount: 1,
  nextRetryAt: null,
  failureClassification: ScheduledPayoutFailureClassification.permanent,
  reconciliationStatus: "none" as never,
  correlationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  status: StripeConnectScheduledPayoutRequestStatus.failed,
});
assert(!permanentGate.allowed && permanentGate.reason === "permanent_failure", "destination fix does not auto-retry failed row");
__resetScheduledBankPayoutDestinationStripeFnsForTests();

// Compatible bank proceeds
__setScheduledBankPayoutDestinationStripeFnsForTests({
  listExternalAccounts: async () => ({
    object: "list",
    data: [bankEur({ id: "ba_ok", defaultForCurrency: true, methods: ["standard"] })],
    has_more: false,
    url: "/v1/accounts/acct_test/external_accounts",
  }),
});
const okBank = await validateScheduledStandardPayoutDestination({
  stripeAccountId: "acct_test_ok",
  currency: "eur",
});
assert(okBank.ok && okBank.destination.supportsStandard, "bank with standard proceeds");
__resetScheduledBankPayoutDestinationStripeFnsForTests();

// Ambiguous: no default marked
__setScheduledBankPayoutDestinationStripeFnsForTests({
  listExternalAccounts: async () => ({
    object: "list",
    data: [
      bankEur({ id: "ba_a", defaultForCurrency: false, methods: ["standard"] }),
      bankEur({ id: "ba_b", defaultForCurrency: false, methods: ["standard"] }),
    ],
    has_more: false,
    url: "/v1/accounts/acct_test/external_accounts",
  }),
});
const ambiguous = await validateScheduledStandardPayoutDestination({
  stripeAccountId: "acct_ambiguous",
  currency: "eur",
});
assert(!ambiguous.ok && ambiguous.diagnostics.failureCode === "payout_destination_ambiguous", "ambiguous fails closed");
__resetScheduledBankPayoutDestinationStripeFnsForTests();

// Missing currency (only USD external, payout is EUR)
__setScheduledBankPayoutDestinationStripeFnsForTests({
  listExternalAccounts: async () => ({
    object: "list",
    data: [
      {
        id: "ba_usd_only",
        object: "bank_account",
        currency: "usd",
        default_for_currency: true,
        available_payout_methods: ["standard"],
      } as Stripe.BankAccount,
    ],
    has_more: false,
    url: "/v1/accounts/acct_test/external_accounts",
  }),
});
const missing = await validateScheduledStandardPayoutDestination({
  stripeAccountId: "acct_missing_eur",
  currency: "eur",
});
assert(!missing.ok && missing.diagnostics.failureCode === "payout_destination_missing", "missing eur destination");
__resetScheduledBankPayoutDestinationStripeFnsForTests();

// Stripe 400 debit card message → permanent code (historical Charline shape)
const stripeDebitErr = Object.assign(new Error("Method 'standard' is not supported for payouts to debit cards."), {
  statusCode: 400,
  code: "invalid_request_error",
  type: "StripeInvalidRequestError",
});
const hist = extractStripePayoutCreateDiagnostics(stripeDebitErr);
assert(hist.failureCode === "payout_destination_incompatible", "stripe debit message mapped");
assert(
  classifyStripePayoutError(
    { code: hist.stripeErrorCode, type: hist.stripeErrorType, status: hist.stripeHttpStatus },
    hist.failureMessage,
  ) === ScheduledPayoutFailureClassification.permanent,
  "stripe debit permanent",
);

console.log("scheduled-bank-payout-destination-runtime: ok");
