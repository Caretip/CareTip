/**
 * Manager-initiated Stripe Connect Instant Payouts.
 *
 * Eligibility and amount come from Stripe (balance + external accounts).
 * CareTip 1.5% markup is Stripe Platform Pricing (application fee) — not subtracted in code.
 * Payout amount is instant_available.net_available when present (net of platform fees).
 * Stripe’s 1% Instant fee is a Connect platform charge (Dashboard), not a second CareTip deduction.
 */
import type Stripe from "stripe";
import { StripeConnectInstantPayoutRequestStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { StripeConnectError } from "./stripeConnect.service.js";
import {
  getPayoutForBusiness,
  ingestStripePayoutObjectForBusiness,
  invalidateConnectPayoutListSyncThrottle,
  type ConnectPayoutDto,
} from "./stripeConnectPayout.service.js";

/** Fanny’s intended user-facing total after Platform Pricing is set to 2.5%. */
export const CARETIP_INSTANT_PAYOUT_TARGET_TOTAL_FEE_BPS = 250;
/** CareTip markup portion of that 2.5% (Stripe Instant 1% is billed to the platform). */
export const CARETIP_INSTANT_PAYOUT_PLATFORM_MARKUP_BPS = 150;
export const STRIPE_INSTANT_PAYOUT_CONNECT_FEE_BPS = 100;

const EU_INSTANT_COUNTRIES = new Set([
  "AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK",
]);
const INSTANT_PAYOUT_COUNTRIES = new Set([
  ...EU_INSTANT_COUNTRIES,
  "AE", "AU", "CA", "DK", "GB", "HK", "HU", "MY", "NO", "NZ", "PL", "RO", "SE", "SG", "US", "CZ",
]);

const EUR_INSTANT_MIN_CENTS = 40;
const EUR_INSTANT_MAX_CENTS = 999_900;

const SAFE_CREATE_MSG = "Unable to start an Instant Payout right now. Please try again.";

export type InstantPayoutReason =
  | "not_connected"
  | "stripe_not_configured"
  | "business_closed"
  | "payouts_disabled"
  | "country_unsupported"
  | "no_instant_destination"
  | "zero_balance"
  | "below_minimum"
  | "eligible";

export type InstantPayoutEligibilityDto = {
  connected: boolean;
  eligible: boolean;
  reason: InstantPayoutReason;
  payoutsEnabled: boolean;
  currency: string | null;
  instantAvailableGrossCents: number;
  instantAvailableNetCents: number;
  availableCents: number;
  pendingCents: number;
  platformFeeCents: number;
  feeConfigured: boolean;
  targetTotalFeeBps: number;
  displayedFeeBps: number | null;
  destinationLast4: string | null;
  destinationKind: "card" | "bank_account" | null;
  canOpenExpressDashboard: boolean;
};

export type InstantAccountSnapshot = InstantPayoutEligibilityDto & {
  stripeAccountId: string;
  destinationId: string | null;
  accountCountry: string | null;
};

type InstantSnapshot = InstantAccountSnapshot;

type RetrieveBalanceFn = (stripeAccountId: string) => Promise<Stripe.Balance>;
type ListExternalAccountsFn = (stripeAccountId: string) => Promise<Stripe.ApiList<Stripe.BankAccount | Stripe.Card>>;
type RetrieveAccountFn = (stripeAccountId: string) => Promise<Pick<Stripe.Account, "country" | "payouts_enabled" | "charges_enabled">>;
type CreateInstantPayoutFn = (args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  destination: string;
  idempotencyKey: string;
}) => Promise<Stripe.Payout>;

let retrieveBalanceFn: RetrieveBalanceFn | null = null;
let listExternalAccountsFn: ListExternalAccountsFn | null = null;
let retrieveAccountFn: RetrieveAccountFn | null = null;
let createInstantPayoutFn: CreateInstantPayoutFn | null = null;

export function __setInstantPayoutStripeFnsForTests(fns: {
  retrieveBalance?: RetrieveBalanceFn | null;
  listExternalAccounts?: ListExternalAccountsFn | null;
  retrieveAccount?: RetrieveAccountFn | null;
  createInstantPayout?: CreateInstantPayoutFn | null;
}): void {
  retrieveBalanceFn = fns.retrieveBalance === undefined ? retrieveBalanceFn : fns.retrieveBalance;
  listExternalAccountsFn = fns.listExternalAccounts === undefined ? listExternalAccountsFn : fns.listExternalAccounts;
  retrieveAccountFn = fns.retrieveAccount === undefined ? retrieveAccountFn : fns.retrieveAccount;
  createInstantPayoutFn = fns.createInstantPayout === undefined ? createInstantPayoutFn : fns.createInstantPayout;
}

export function __resetInstantPayoutStripeFnsForTests(): void {
  retrieveBalanceFn = null;
  listExternalAccountsFn = null;
  retrieveAccountFn = null;
  createInstantPayoutFn = null;
}

function platformCountry(): string {
  const raw = process.env.STRIPE_PLATFORM_COUNTRY?.trim().toUpperCase()
    || process.env.STRIPE_CONNECT_DEFAULT_COUNTRY?.trim().toUpperCase();
  if (raw && /^[A-Z]{2}$/.test(raw)) return raw;
  return "DE";
}

function isInstantCountry(code: string | null | undefined): boolean {
  const c = String(code ?? "").trim().toUpperCase();
  return Boolean(c) && INSTANT_PAYOUT_COUNTRIES.has(c);
}

function instantMinCents(currency: string): number {
  return currency === "eur" ? EUR_INSTANT_MIN_CENTS : 50;
}

export function stripeInstantPayoutMinCents(currency: string): number {
  return instantMinCents(currency);
}

export function instantPayoutMaxCents(currency: string): number {
  return currency === "eur" ? EUR_INSTANT_MAX_CENTS : 999_900;
}

function assertBusinessMayPayout(business: { deletedAt: Date | null; legalHold: boolean }): void {
  if (business.deletedAt) {
    throw new StripeConnectError(
      "This business is closed and cannot start Instant Payouts.",
      "BUSINESS_SOFT_CLOSED",
      403,
    );
  }
  if (business.legalHold) {
    throw new StripeConnectError(
      "Instant Payouts are blocked while this business is under legal hold.",
      "BUSINESS_LEGAL_HOLD",
      403,
    );
  }
}

function emptyEligibility(partial: Partial<InstantPayoutEligibilityDto> & { reason: InstantPayoutReason }): InstantPayoutEligibilityDto {
  return {
    connected: false,
    eligible: false,
    payoutsEnabled: false,
    currency: null,
    instantAvailableGrossCents: 0,
    instantAvailableNetCents: 0,
    availableCents: 0,
    pendingCents: 0,
    platformFeeCents: 0,
    feeConfigured: false,
    targetTotalFeeBps: CARETIP_INSTANT_PAYOUT_TARGET_TOTAL_FEE_BPS,
    displayedFeeBps: null,
    destinationLast4: null,
    destinationKind: null,
    canOpenExpressDashboard: false,
    ...partial,
  };
}

export function toPublicInstantEligibility(snap: InstantSnapshot): InstantPayoutEligibilityDto {
  const { stripeAccountId: _a, destinationId: _d, accountCountry: _c, ...pub } = snap;
  return pub;
}

function balanceAmount(entries: Stripe.Balance.Available[] | undefined, currency: string): number {
  const row = (entries ?? []).find((e) => String(e.currency).toLowerCase() === currency);
  return typeof row?.amount === "number" && Number.isInteger(row.amount) ? row.amount : 0;
}

async function retrieveBalance(stripeAccountId: string): Promise<Stripe.Balance> {
  if (retrieveBalanceFn) return retrieveBalanceFn(stripeAccountId);
  return getStripeClient().balance.retrieve(
    { expand: ["instant_available.net_available"] },
    { stripeAccount: stripeAccountId },
  );
}

async function retrieveAccount(stripeAccountId: string): Promise<Pick<Stripe.Account, "country" | "payouts_enabled" | "charges_enabled">> {
  if (retrieveAccountFn) return retrieveAccountFn(stripeAccountId);
  return getStripeClient().accounts.retrieve(stripeAccountId);
}

async function listExternalAccounts(
  stripeAccountId: string,
): Promise<Stripe.ApiList<Stripe.BankAccount | Stripe.Card>> {
  if (listExternalAccountsFn) return listExternalAccountsFn(stripeAccountId);
  return getStripeClient().accounts.listExternalAccounts(stripeAccountId, { limit: 100 });
}

function methodsIncludeInstant(account: Stripe.BankAccount | Stripe.Card): boolean {
  const methods = (account as Stripe.BankAccount).available_payout_methods;
  return Array.isArray(methods) && methods.includes("instant");
}

function last4Of(account: Stripe.BankAccount | Stripe.Card): string | null {
  const last4 = (account as Stripe.BankAccount).last4;
  return typeof last4 === "string" && /^\d{2,4}$/.test(last4) ? last4.slice(-4) : null;
}

function kindOf(account: Stripe.BankAccount | Stripe.Card): "card" | "bank_account" {
  return account.object === "card" ? "card" : "bank_account";
}

/**
 * Stripe-authoritative Instant eligibility for a connected account.
 * minNetCents is a CareTip floor on top of Stripe's currency minimum (EU Instant min is 40¢).
 */
export async function evaluateInstantPayoutForStripeAccount(args: {
  stripeAccountId: string;
  payoutsEnabledFallback: boolean;
  minNetCents?: number;
  logContext?: Record<string, unknown>;
}): Promise<InstantSnapshot> {
  if (!isStripeConfigured() && !retrieveBalanceFn) {
    return {
      ...emptyEligibility({ reason: "stripe_not_configured" }),
      stripeAccountId: "",
      destinationId: null,
      accountCountry: null,
    };
  }

  const stripeAccountId = args.stripeAccountId.trim();
  if (!stripeAccountId.startsWith("acct_")) {
    return {
      ...emptyEligibility({ reason: "not_connected" }),
      stripeAccountId: "",
      destinationId: null,
      accountCountry: null,
    };
  }

  const platform = platformCountry();
  if (!isInstantCountry(platform)) {
    return {
      ...emptyEligibility({
        connected: true,
        reason: "country_unsupported",
        payoutsEnabled: args.payoutsEnabledFallback,
        canOpenExpressDashboard: true,
      }),
      stripeAccountId,
      destinationId: null,
      accountCountry: null,
    };
  }

  let account: Pick<Stripe.Account, "country" | "payouts_enabled" | "charges_enabled">;
  let balance: Stripe.Balance;
  let externals: Stripe.ApiList<Stripe.BankAccount | Stripe.Card>;
  try {
    [account, balance, externals] = await Promise.all([
      retrieveAccount(stripeAccountId),
      retrieveBalance(stripeAccountId),
      listExternalAccounts(stripeAccountId),
    ]);
  } catch (err) {
    logServerError("stripeConnectInstantPayout.eligibility_stripe", err, args.logContext ?? {});
    throw new StripeConnectError(SAFE_CREATE_MSG, "INSTANT_PAYOUT_STRIPE_ERROR", 502);
  }

  const accountCountry = String(account.country ?? "").toUpperCase() || null;
  const payoutsEnabled = account.payouts_enabled === true || args.payoutsEnabledFallback;
  if (!payoutsEnabled) {
    return {
      ...emptyEligibility({
        connected: true,
        reason: "payouts_disabled",
        payoutsEnabled: false,
        canOpenExpressDashboard: true,
      }),
      stripeAccountId,
      destinationId: null,
      accountCountry,
    };
  }

  if (!isInstantCountry(accountCountry)) {
    return {
      ...emptyEligibility({
        connected: true,
        reason: "country_unsupported",
        payoutsEnabled: true,
        canOpenExpressDashboard: true,
      }),
      stripeAccountId,
      destinationId: null,
      accountCountry,
    };
  }

  const instantRows = (balance.instant_available ?? []) as Array<
    Stripe.Balance.Available & {
      net_available?: Array<{ amount: number; destination?: string }>;
    }
  >;
  const preferred =
    instantRows.find((row) => String(row.currency).toLowerCase() === "eur") ?? instantRows[0];
  const currency = String(preferred?.currency ?? "eur").toLowerCase().slice(0, 8);
  const gross = typeof preferred?.amount === "number" ? preferred.amount : 0;
  const netEntries = Array.isArray(preferred?.net_available) ? preferred.net_available : [];
  const instantExternals = (externals.data ?? []).filter(methodsIncludeInstant);

  const netByInstantDest = netEntries.find((entry) =>
    instantExternals.some((a) => a.id === entry.destination),
  );
  const netEntry = netByInstantDest ?? netEntries[0];
  const feeConfigured = typeof netEntry?.amount === "number" && Number.isInteger(netEntry.amount);
  const net = feeConfigured ? netEntry!.amount : gross;
  const destinationFromBalance =
    typeof netEntry?.destination === "string" && netEntry.destination.trim()
      ? netEntry.destination.trim()
      : null;

  const destAccount =
    (destinationFromBalance
      ? instantExternals.find((a) => a.id === destinationFromBalance)
      : undefined) ?? instantExternals[0];

  const destinationId = destAccount?.id ?? destinationFromBalance;
  const hasInstantDest = Boolean(destinationFromBalance) || instantExternals.length > 0;

  if (!hasInstantDest) {
    return {
      ...emptyEligibility({
        connected: true,
        reason: "no_instant_destination",
        payoutsEnabled: true,
        currency,
        instantAvailableGrossCents: Math.max(0, gross),
        instantAvailableNetCents: Math.max(0, net),
        availableCents: balanceAmount(balance.available, currency),
        pendingCents: balanceAmount(balance.pending, currency),
        canOpenExpressDashboard: true,
      }),
      stripeAccountId,
      destinationId: null,
      accountCountry,
    };
  }

  const platformFeeCents = Math.max(0, gross - net);
  const displayedFeeBps = gross > 0 ? Math.round((platformFeeCents / gross) * 10_000) : null;
  const min = Math.max(instantMinCents(currency), Math.max(0, args.minNetCents ?? 0));

  let reason: InstantPayoutReason = "eligible";
  let eligible = true;
  if (net <= 0) {
    reason = "zero_balance";
    eligible = false;
  } else if (net < min) {
    reason = "below_minimum";
    eligible = false;
  }

  return {
    connected: true,
    eligible,
    reason,
    payoutsEnabled: true,
    currency,
    instantAvailableGrossCents: Math.max(0, gross),
    instantAvailableNetCents: Math.max(0, net),
    availableCents: balanceAmount(balance.available, currency),
    pendingCents: balanceAmount(balance.pending, currency),
    platformFeeCents,
    feeConfigured,
    targetTotalFeeBps: CARETIP_INSTANT_PAYOUT_TARGET_TOTAL_FEE_BPS,
    displayedFeeBps,
    destinationLast4: destAccount ? last4Of(destAccount) : null,
    destinationKind: destAccount ? kindOf(destAccount) : "bank_account",
    canOpenExpressDashboard: true,
    stripeAccountId,
    destinationId: destinationId!,
    accountCountry,
  };
}

async function buildSnapshot(businessId: string): Promise<InstantSnapshot> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      deletedAt: true,
      legalHold: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
    },
  });
  if (!business) {
    throw new StripeConnectError("Business not found", "BUSINESS_NOT_FOUND", 404);
  }
  assertBusinessMayPayout(business);

  return evaluateInstantPayoutForStripeAccount({
    stripeAccountId: business.stripeAccountId?.trim() ?? "",
    payoutsEnabledFallback: business.stripePayoutsEnabled,
    minNetCents: 0,
    logContext: { businessId },
  });
}

export async function createInstantPayoutOnConnectedAccount(args: {
  stripeAccountId: string;
  amountCents: number;
  currency: string;
  destination: string;
  idempotencyKey: string;
}): Promise<Stripe.Payout> {
  if (createInstantPayoutFn) {
    return createInstantPayoutFn(args);
  }
  return getStripeClient().payouts.create(
    {
      amount: args.amountCents,
      currency: args.currency,
      method: "instant",
      destination: args.destination,
    },
    {
      stripeAccount: args.stripeAccountId,
      idempotencyKey: args.idempotencyKey,
    },
  );
}

export async function getInstantPayoutEligibilityForBusiness(
  businessId: string,
): Promise<InstantPayoutEligibilityDto> {
  const snap = await buildSnapshot(businessId);
  return toPublicInstantEligibility(snap);
}

export function normalizeInstantPayoutIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new StripeConnectError("Invalid request.", "INSTANT_PAYOUT_IDEMPOTENCY_REQUIRED", 400);
  }
  const key = raw.trim();
  if (!/^[A-Za-z0-9:_-]{16,128}$/.test(key)) {
    throw new StripeConnectError("Invalid request.", "INSTANT_PAYOUT_IDEMPOTENCY_REQUIRED", 400);
  }
  return key;
}

export function mapInstantPayoutCreateError(err: unknown): StripeConnectError {
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code ?? "") : "";
  if (code === "balance_insufficient") {
    return new StripeConnectError(
      "There is not enough Instant Payout balance for this request.",
      "INSTANT_PAYOUT_INSUFFICIENT",
      400,
    );
  }
  if (code === "instant_payouts_unsupported" || code === "payouts_not_allowed") {
    return new StripeConnectError(
      "Instant Payout is not available for this Stripe account.",
      "INSTANT_PAYOUT_UNSUPPORTED",
      400,
    );
  }
  logServerError("stripeConnectInstantPayout.create", err);
  return new StripeConnectError(SAFE_CREATE_MSG, "INSTANT_PAYOUT_STRIPE_ERROR", 502);
}

export async function createInstantPayoutForBusiness(args: {
  businessId: string;
  idempotencyKey: unknown;
}): Promise<{ payout: ConnectPayoutDto; eligibility: InstantPayoutEligibilityDto }> {
  const idempotencyKey = normalizeInstantPayoutIdempotencyKey(args.idempotencyKey);
  const ledgerKey = `caretip_instant_payout:${args.businessId}:${idempotencyKey}`;

  return runSerializedByKey(`instant-payout:${args.businessId}`, async () => {
    const existing = await prisma.stripeConnectInstantPayoutRequest.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (existing?.status === StripeConnectInstantPayoutRequestStatus.submitted && existing.stripePayoutId) {
      const payout = await prisma.stripeConnectPayout.findFirst({
        where: { stripePayoutId: existing.stripePayoutId, businessId: args.businessId },
        select: { id: true },
      });
      if (payout) {
        const dto = await getPayoutForBusiness(args.businessId, payout.id);
        const eligibility = await getInstantPayoutEligibilityForBusiness(args.businessId);
        if (dto) return { payout: dto, eligibility };
      }
    }

    const snap = await buildSnapshot(args.businessId);
    if (!snap.eligible || !snap.destinationId || !snap.currency) {
      throw new StripeConnectError(
        snap.reason === "no_instant_destination"
          ? "Add an Instant-eligible payout method in Stripe before requesting an Instant Payout."
          : snap.reason === "zero_balance" || snap.reason === "below_minimum"
            ? "There is no Instant Payout balance available right now."
            : "Instant Payout is not available for this account.",
        `INSTANT_PAYOUT_${snap.reason.toUpperCase()}`,
        400,
      );
    }

    const amountCents = snap.instantAvailableNetCents;
    const max = instantPayoutMaxCents(snap.currency);
    if (amountCents > max) {
      throw new StripeConnectError(
        "This Instant Payout exceeds Stripe’s maximum for this currency.",
        "INSTANT_PAYOUT_ABOVE_MAXIMUM",
        400,
      );
    }

    const request = existing
      ? existing
      : await prisma.stripeConnectInstantPayoutRequest.create({
          data: {
            businessId: args.businessId,
            idempotencyKey: ledgerKey,
            amountCents,
            currency: snap.currency,
            status: StripeConnectInstantPayoutRequestStatus.pending,
          },
        });

    if (
      request.status === StripeConnectInstantPayoutRequestStatus.submitted &&
      request.stripePayoutId
    ) {
      const payout = await prisma.stripeConnectPayout.findFirst({
        where: { stripePayoutId: request.stripePayoutId, businessId: args.businessId },
        select: { id: true },
      });
      if (payout) {
        const dto = await getPayoutForBusiness(args.businessId, payout.id);
        if (dto) {
          return { payout: dto, eligibility: toPublicInstantEligibility(snap) };
        }
      }
    }

    let stripePayout: Stripe.Payout;
    try {
      stripePayout = await createInstantPayoutOnConnectedAccount({
        stripeAccountId: snap.stripeAccountId,
        amountCents,
        currency: snap.currency,
        destination: snap.destinationId,
        idempotencyKey: ledgerKey,
      });
    } catch (err) {
      await prisma.stripeConnectInstantPayoutRequest.update({
        where: { id: request.id },
        data: {
          status: StripeConnectInstantPayoutRequestStatus.failed,
          failureCode: "stripe_create_failed",
        },
      });
      throw mapInstantPayoutCreateError(err);
    }

    await prisma.stripeConnectInstantPayoutRequest.update({
      where: { id: request.id },
      data: {
        status: StripeConnectInstantPayoutRequestStatus.submitted,
        stripePayoutId: stripePayout.id,
        amountCents,
        currency: snap.currency,
      },
    });

    await ingestStripePayoutObjectForBusiness({
      businessId: args.businessId,
      stripeAccountId: snap.stripeAccountId,
      payout: stripePayout,
      eventType: "payout.api_create",
      eventId: `instant_create:${ledgerKey}`,
    });
    invalidateConnectPayoutListSyncThrottle(args.businessId);

    const row = await prisma.stripeConnectPayout.findFirst({
      where: { stripePayoutId: stripePayout.id, businessId: args.businessId },
      select: { id: true },
    });
    const dto = row ? await getPayoutForBusiness(args.businessId, row.id) : null;
    if (!dto) {
      throw new StripeConnectError(SAFE_CREATE_MSG, "INSTANT_PAYOUT_PERSIST_FAILED", 502);
    }

    const eligibility = await getInstantPayoutEligibilityForBusiness(args.businessId);
    return { payout: dto, eligibility };
  });
}

export const INSTANT_PAYOUT_MARKUP_BPS = CARETIP_INSTANT_PAYOUT_PLATFORM_MARKUP_BPS;
export const STRIPE_INSTANT_CONNECT_FEE_BPS = STRIPE_INSTANT_PAYOUT_CONNECT_FEE_BPS;
