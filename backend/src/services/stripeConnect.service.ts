/**
 * Stripe Connect Express — Phase 1 / 1.6 foundation.
 * Account create, Account Links, status mirror, concurrency + stale-webhook hardening.
 * Phase 2 destination-charge Checkout lives in stripe.service.ts (destination from Business.stripeAccountId).
 */
import Stripe from "stripe";
import { Prisma, StripeConnectStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { logServerError } from "../utils/httpErrors.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";

/** Official Accounts V2 create path — stripe@17.7.0 has no stripe.v2.core.accounts helper. */
export const STRIPE_ACCOUNTS_V2_CREATE_PATH = "/v2/core/accounts" as const;
/** Official Accounts V2 Account Link path (underscore). */
export const STRIPE_ACCOUNTS_V2_ACCOUNT_LINKS_PATH = "/v2/core/account_links" as const;
/**
 * Stripe-Version for V2 create / account_links only.
 * stripe@17.7.0 defaults to 2025-02-24.acacia, which does not support Accounts V2.
 * Does not change the global Stripe client used for Checkout, refunds, or webhooks.
 */
export const DEFAULT_ACCOUNTS_V2_API_VERSION = "2026-07-29.dahlia" as const;

const CONNECT_USER_CREATE_FAILED =
  "Stripe connection couldn't be started. Please try again.";
const CONNECT_USER_RETRIEVE_FAILED =
  "Stripe connection couldn't be started. Please try again.";
const CONNECT_USER_TENANT_CONFLICT =
  "Stripe connection couldn't be started. Please try again.";

export class StripeConnectError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus = 400) {
    super(message);
    this.name = "StripeConnectError";
    this.code = code;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function frontendBaseUrl(): string {
  return (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "");
}

/** ISO country for Express account create — server-only; never from client. */
function connectDefaultCountry(): string {
  const raw = process.env.STRIPE_CONNECT_DEFAULT_COUNTRY?.trim().toUpperCase();
  if (raw && /^[A-Z]{2}$/.test(raw)) return raw;
  return "DE";
}

/** Deterministic Stripe idempotency key — one Express/V2 create attempt stream per Business. */
export function connectExpressIdempotencyKey(businessId: string): string {
  return `connect_express:${businessId.trim()}`;
}

function accountsV2ApiVersion(): string {
  const raw = process.env.STRIPE_ACCOUNTS_V2_API_VERSION?.trim();
  return raw || DEFAULT_ACCOUNTS_V2_API_VERSION;
}

/**
 * stripe@17.7.0 JSON-encodes /v2 bodies, then sets Content-Length from JS string.length.
 * Non-ASCII (e.g. display_name "Brasserie Lindenstraße") is more UTF-8 bytes than
 * UTF-16 code units, so Stripe's ingress truncates the body → invalid_request_json_body.
 * See stripe-node PR #2485. additionalHeaders replaces opts.headers in this SDK, so
 * Stripe-Version and Idempotency-Key must be restated here — not omitted.
 */
export function v2JsonUtf8ContentLength(body: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

export function accountsV2RequestOptions(
  body: Record<string, unknown>,
  extra?: Stripe.RequestOptions,
): Stripe.RawRequestOptions {
  const stripeVersion = accountsV2ApiVersion();
  const additionalHeaders: Record<string, string> = {
    "Stripe-Version": stripeVersion,
    "Content-Length": String(v2JsonUtf8ContentLength(body)),
  };
  const idempotencyKey = extra?.idempotencyKey?.trim();
  if (idempotencyKey) {
    additionalHeaders["Idempotency-Key"] = idempotencyKey;
  }
  return {
    ...extra,
    apiVersion: stripeVersion,
    additionalHeaders,
  } as Stripe.RawRequestOptions;
}

/**
 * GET /v2/core/accounts/:id — apiVersion only.
 * Do not set additionalHeaders/Content-Length; stripe-node treats those as a GET body
 * and Stripe then fails the retrieve (which would incorrectly look like a non-V2 account).
 */
export function accountsV2GetRequestOptions(): Stripe.RawRequestOptions {
  return {
    apiVersion: accountsV2ApiVersion(),
  } as Stripe.RawRequestOptions;
}

export function accountsV2RetrievePath(accountId: string): string {
  return `${STRIPE_ACCOUNTS_V2_CREATE_PATH}/${encodeURIComponent(accountId)}`;
}

/** Includes required to read V2 capability status (charges/payouts). */
export const ACCOUNTS_V2_STATUS_INCLUDES = [
  "configuration.merchant",
  "configuration.recipient",
  "identity",
  "requirements",
] as const;

export function accountsV2RetrievePathWithIncludes(accountId: string): string {
  const query = ACCOUNTS_V2_STATUS_INCLUDES.map((item) => `include=${encodeURIComponent(item)}`).join(
    "&",
  );
  return `${accountsV2RetrievePath(accountId)}?${query}`;
}

/** Configurations requested when CareTip creates a new V2 account. Existing accounts may differ. */
export const CARETIP_NEW_ACCOUNT_V2_CONFIGURATIONS = ["merchant", "recipient"] as const;

const V2_LINK_CONFIGURATION_ALLOW = new Set(["customer", "merchant", "recipient", "storer"]);

export function normalizeAccountsV2LinkConfigurations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const v = item.trim().toLowerCase();
    if (!V2_LINK_CONFIGURATION_ALLOW.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Express-equivalent V2 create body for destination charges (merchant + recipient). */
export function buildAccountsV2CreateParams(input: {
  country: string;
  contactEmail: string;
  displayName: string;
  businessId?: string;
}): Record<string, unknown> {
  const country = input.country.trim().toLowerCase();
  const email = input.contactEmail.trim();
  const businessId = input.businessId?.trim();
  return {
    dashboard: "express",
    ...(email ? { contact_email: email } : {}),
    display_name: input.displayName.trim().slice(0, 100) || "CareTip business",
    identity: { country: country || "de" },
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      merchant: {
        capabilities: {
          card_payments: { requested: true },
        },
      },
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
    ...(businessId ? { metadata: { caretip_business_id: businessId } } : {}),
    include: ["configuration.merchant", "configuration.recipient", "identity", "defaults"],
  };
}

export function buildAccountsV2AccountLinkParams(input: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
  configurations: readonly string[];
}): Record<string, unknown> {
  const configurations = normalizeAccountsV2LinkConfigurations([...input.configurations]);
  if (configurations.length === 0) {
    throw new StripeConnectError(
      "Could not open Stripe onboarding. Please try again.",
      "STRIPE_ACCOUNT_LINK_CONFIGS_EMPTY",
      502,
    );
  }
  return {
    account: input.accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        configurations,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
      },
    },
  };
}

function isStripeConnectedAccountId(id: string): boolean {
  return /^acct_[A-Za-z0-9_]+$/.test(id) && id.length >= 10 && id.length <= 128;
}

/** Runtime test fixtures — never send these to live Stripe. */
function isSyntheticConnectAccountId(id: string): boolean {
  return /^acct_(p\d+_|stale_|ready_|unknown_|shared_)/i.test(id);
}

function isStripeAccountUnreachable(err: unknown): boolean {
  if (isStripeResourceMissing(err)) return true;
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "account_invalid" || code === "invalid_fields";
}

function stripeOpsMeta(err: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!err || typeof err !== "object") return out;
  const e = err as {
    type?: unknown;
    code?: unknown;
    requestId?: unknown;
    statusCode?: unknown;
  };
  if (typeof e.type === "string" && e.type.trim()) out.stripeType = e.type.trim().slice(0, 64);
  if (typeof e.code === "string" && e.code.trim()) out.stripeCode = e.code.trim().slice(0, 64);
  if (typeof e.requestId === "string" && e.requestId.trim()) {
    out.stripeRequestId = e.requestId.trim().slice(0, 64);
  }
  if (typeof e.statusCode === "number" && Number.isFinite(e.statusCode)) {
    out.stripeStatus = e.statusCode;
  }
  return out;
}

function isStripeResourceMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; statusCode?: unknown };
  if (e.code === "resource_missing") return true;
  return e.statusCode === 404;
}

function parseV2CreatedAccountId(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new StripeConnectError(CONNECT_USER_CREATE_FAILED, "STRIPE_ACCOUNT_CREATE_FAILED", 502);
  }
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== "string" || !isStripeConnectedAccountId(id.trim())) {
    throw new StripeConnectError(CONNECT_USER_CREATE_FAILED, "STRIPE_ACCOUNT_CREATE_FAILED", 502);
  }
  return id.trim();
}

function parseV2AccountLinkUrl(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new StripeConnectError(
      "Could not open Stripe onboarding. Please try again.",
      "STRIPE_ACCOUNT_LINK_EMPTY",
      502,
    );
  }
  const url = (payload as { url?: unknown }).url;
  if (typeof url !== "string" || !url.trim().startsWith("https://")) {
    throw new StripeConnectError(
      "Could not open Stripe onboarding. Please try again.",
      "STRIPE_ACCOUNT_LINK_EMPTY",
      502,
    );
  }
  return url.trim();
}

function pendingOnboardingSnapshot(accountId: string): Stripe.Account {
  return {
    id: accountId,
    object: "account",
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      disabled_reason: null,
    },
  } as unknown as Stripe.Account;
}

/**
 * Stale `account.updated` guard.
 * Accept when no prior accepted time, or event.created >= last accepted (equal = idempotent replay).
 */
export function shouldAcceptConnectAccountEvent(params: {
  eventCreatedUnix: number;
  lastAcceptedAt: Date | null;
}): boolean {
  if (!Number.isFinite(params.eventCreatedUnix) || params.eventCreatedUnix <= 0) {
    return false;
  }
  if (!params.lastAcceptedAt) return true;
  const eventMs = Math.floor(params.eventCreatedUnix) * 1000;
  return eventMs >= params.lastAcceptedAt.getTime();
}

export type ConnectStatusDto = {
  status: StripeConnectStatus;
  stripeConfigured: boolean;
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDueCount: number;
  disabledReason: string | null;
  updatedAt: string | null;
  /** True when charges_enabled && payouts_enabled — Phase 2 tip routing gate. */
  readyForPayouts: boolean;
};

export function deriveStripeConnectStatus(input: {
  hasAccount: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDueCount: number;
  pastDueCount: number;
  disabledReason: string | null;
}): StripeConnectStatus {
  if (!input.hasAccount) return StripeConnectStatus.not_connected;

  // Tip routing key is charges + payouts. Stripe can leave past_due / disabled_reason
  // populated after payments are already active; that must not keep CareTip restricted.
  if (input.chargesEnabled && input.payoutsEnabled) {
    return StripeConnectStatus.ready;
  }

  if (input.disabledReason || input.pastDueCount > 0) {
    return StripeConnectStatus.restricted;
  }

  if (input.currentlyDueCount > 0) {
    return input.detailsSubmitted
      ? StripeConnectStatus.requires_information
      : StripeConnectStatus.onboarding_incomplete;
  }

  if (!input.detailsSubmitted) {
    return StripeConnectStatus.onboarding_required;
  }

  return StripeConnectStatus.onboarding_incomplete;
}

function snapshotFromStripeAccount(account: Stripe.Account): {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDueCount: number;
  pastDueCount: number;
  disabledReason: string | null;
  status: StripeConnectStatus;
} {
  const req = account.requirements;
  const currentlyDueCount = Array.isArray(req?.currently_due) ? req!.currently_due!.length : 0;
  const pastDueCount = Array.isArray(req?.past_due) ? req!.past_due!.length : 0;
  const disabledReason =
    typeof req?.disabled_reason === "string" && req.disabled_reason.trim()
      ? req.disabled_reason.trim().slice(0, 128)
      : null;
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const detailsSubmitted = account.details_submitted === true;
  const status = deriveStripeConnectStatus({
    hasAccount: true,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDueCount,
    pastDueCount,
    disabledReason,
  });
  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDueCount,
    pastDueCount,
    disabledReason,
    status,
  };
}

type ConnectCapabilitySnapshot = ReturnType<typeof snapshotFromStripeAccount>;

function isStripeCapabilityActive(status: unknown): boolean {
  return typeof status === "string" && status.trim().toLowerCase() === "active";
}

function readNestedStatus(root: unknown, path: string[]): unknown {
  let cur: unknown = root;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function parseV2RequirementCounts(requirements: unknown): {
  currentlyDueCount: number;
  pastDueCount: number;
  disabledReason: string | null;
} {
  if (!requirements || typeof requirements !== "object") {
    return { currentlyDueCount: 0, pastDueCount: 0, disabledReason: null };
  }
  const req = requirements as {
    currently_due?: unknown;
    past_due?: unknown;
    entries?: unknown;
    disabled_reason?: unknown;
  };
  const currentlyDueCount = Array.isArray(req.currently_due)
    ? req.currently_due.length
    : Array.isArray(req.entries)
      ? req.entries.length
      : 0;
  const pastDueCount = Array.isArray(req.past_due) ? req.past_due.length : 0;
  const disabledReason =
    typeof req.disabled_reason === "string" && req.disabled_reason.trim()
      ? req.disabled_reason.trim().slice(0, 128)
      : null;
  return { currentlyDueCount, pastDueCount, disabledReason };
}

/**
 * Accounts V2 has no top-level charges_enabled / payouts_enabled.
 * Map merchant card_payments + recipient/merchant stripe_balance instead.
 */
export function snapshotFromV2CoreAccount(payload: unknown): ConnectCapabilitySnapshot {
  const configuration = readNestedStatus(payload, ["configuration"]);
  const chargesEnabled = isStripeCapabilityActive(
    readNestedStatus(configuration, ["merchant", "capabilities", "card_payments", "status"]),
  );
  const payoutsEnabled =
    isStripeCapabilityActive(
      readNestedStatus(configuration, [
        "recipient",
        "capabilities",
        "stripe_balance",
        "stripe_transfers",
        "status",
      ]),
    ) ||
    isStripeCapabilityActive(
      readNestedStatus(configuration, ["merchant", "capabilities", "stripe_balance", "payouts", "status"]),
    );
  const identity = readNestedStatus(payload, ["identity"]);
  const { currentlyDueCount, pastDueCount, disabledReason } = parseV2RequirementCounts(
    readNestedStatus(payload, ["requirements"]),
  );
  const detailsSubmitted =
    Boolean(identity && typeof identity === "object") ||
    (currentlyDueCount === 0 && (chargesEnabled || payoutsEnabled));
  const status = deriveStripeConnectStatus({
    hasAccount: true,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDueCount,
    pastDueCount,
    disabledReason,
  });
  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    currentlyDueCount,
    pastDueCount,
    disabledReason,
    status,
  };
}

export function isConnectCapabilityReady(snap: Pick<ConnectCapabilitySnapshot, "chargesEnabled" | "payoutsEnabled">): boolean {
  return snap.chargesEnabled && snap.payoutsEnabled;
}

function toStatusDto(row: {
  stripeAccountId: string | null;
  stripeConnectStatus: StripeConnectStatus;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeConnectRequirementsDue: number;
  stripeConnectDisabledReason: string | null;
  stripeConnectUpdatedAt: Date | null;
}): ConnectStatusDto {
  const hasAccount = Boolean(row.stripeAccountId?.trim());
  return {
    status: hasAccount ? row.stripeConnectStatus : StripeConnectStatus.not_connected,
    stripeConfigured: isStripeConfigured(),
    hasAccount,
    chargesEnabled: row.stripeChargesEnabled,
    payoutsEnabled: row.stripePayoutsEnabled,
    detailsSubmitted: row.stripeDetailsSubmitted,
    requirementsDueCount: row.stripeConnectRequirementsDue,
    disabledReason: row.stripeConnectDisabledReason,
    updatedAt: row.stripeConnectUpdatedAt?.toISOString() ?? null,
    readyForPayouts: row.stripeChargesEnabled && row.stripePayoutsEnabled,
  };
}

const CONNECT_SELECT = {
  id: true,
  name: true,
  contactEmail: true,
  deletedAt: true,
  legalHold: true,
  stripeAccountId: true,
  stripeConnectStatus: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  stripeConnectRequirementsDue: true,
  stripeConnectDisabledReason: true,
  stripeConnectUpdatedAt: true,
} as const;

function assertBusinessMayMutateConnect(business: {
  deletedAt: Date | null;
  legalHold: boolean;
}): void {
  if (business.deletedAt) {
    throw new StripeConnectError(
      "This business is closed and cannot manage Stripe Connect.",
      "BUSINESS_SOFT_CLOSED",
      403,
    );
  }
  if (business.legalHold) {
    throw new StripeConnectError(
      "Stripe Connect changes are blocked while this business is under legal hold.",
      "BUSINESS_LEGAL_HOLD",
      403,
    );
  }
}

function connectStatusDataFromSnap(
  snap: ReturnType<typeof snapshotFromStripeAccount>,
  acceptedAt: Date,
  stripeAccountId?: string,
) {
  const status =
    snap.status === StripeConnectStatus.not_connected
      ? StripeConnectStatus.onboarding_required
      : snap.status;
  return {
    ...(stripeAccountId ? { stripeAccountId } : {}),
    stripeConnectStatus: status,
    stripeChargesEnabled: snap.chargesEnabled,
    stripePayoutsEnabled: snap.payoutsEnabled,
    stripeDetailsSubmitted: snap.detailsSubmitted,
    stripeConnectRequirementsDue: snap.currentlyDueCount,
    stripeConnectDisabledReason: snap.disabledReason,
    stripeConnectUpdatedAt: acceptedAt,
  };
}

type CreateAccountFn = (
  params: Stripe.AccountCreateParams,
  options?: Stripe.RequestOptions,
) => Promise<Stripe.Account>;

type CreateV2AccountFn = (
  params: Record<string, unknown>,
  options?: Stripe.RequestOptions,
) => Promise<unknown>;

type CreateV2AccountLinkFn = (
  params: Record<string, unknown>,
  options?: Stripe.RequestOptions,
) => Promise<unknown>;

type RetrieveAccountFn = (accountId: string) => Promise<Stripe.Account>;

type RetrieveV2AppliedConfigurationsFn = (accountId: string) => Promise<string[] | null>;
type RetrieveV2CoreAccountFn = (accountId: string) => Promise<unknown | null>;

/** Test seam — production uses Stripe Accounts V2 via rawRequest. */
let createAccountFn: CreateAccountFn | null = null;
let createV2AccountFn: CreateV2AccountFn | null = null;
let createV2AccountLinkFn: CreateV2AccountLinkFn | null = null;
let retrieveAccountFn: RetrieveAccountFn | null = null;
let retrieveV2AppliedConfigurationsFn: RetrieveV2AppliedConfigurationsFn | null = null;
let retrieveV2CoreAccountFn: RetrieveV2CoreAccountFn | null = null;

export function __setCreateAccountFnForTests(fn: CreateAccountFn | null): void {
  createAccountFn = fn;
}

export function __setCreateV2AccountFnForTests(fn: CreateV2AccountFn | null): void {
  createV2AccountFn = fn;
}

export function __setCreateV2AccountLinkFnForTests(fn: CreateV2AccountLinkFn | null): void {
  createV2AccountLinkFn = fn;
}

export function __setRetrieveAccountFnForTests(fn: RetrieveAccountFn | null): void {
  retrieveAccountFn = fn;
}

export function __setRetrieveV2AppliedConfigurationsFnForTests(
  fn: RetrieveV2AppliedConfigurationsFn | null,
): void {
  retrieveV2AppliedConfigurationsFn = fn;
}

export function __setRetrieveV2CoreAccountFnForTests(fn: RetrieveV2CoreAccountFn | null): void {
  retrieveV2CoreAccountFn = fn;
}

async function retrieveConnectedAccount(accountId: string): Promise<Stripe.Account> {
  if (retrieveAccountFn) return retrieveAccountFn(accountId);
  return getStripeClient().accounts.retrieve(accountId);
}

function parseV2AppliedConfigurations(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  return normalizeAccountsV2LinkConfigurations(
    (payload as { applied_configurations?: unknown }).applied_configurations,
  );
}

/**
 * Existing V2 accounts must use their actual applied_configurations for Account Links.
 * null = not a V2 account (legacy Express → supported V1 Account Link fallback).
 */
async function retrieveV2AppliedConfigurations(accountId: string): Promise<string[] | null> {
  if (retrieveV2AppliedConfigurationsFn) return retrieveV2AppliedConfigurationsFn(accountId);
  // Mocked V2 Account Link tests default to the new-account create configuration.
  if (createV2AccountLinkFn) return [...CARETIP_NEW_ACCOUNT_V2_CONFIGURATIONS];
  if (!isStripeConfigured()) return null;
  try {
    const payload = await retrieveV2CoreAccount(accountId);
    if (payload == null) return null;
    return parseV2AppliedConfigurations(payload);
  } catch (err) {
    if (isStripeResourceMissing(err)) {
      console.info("[stripe.connect] v2.accounts.retrieve_not_found", {
        accountSuffix: accountId.slice(-8),
        ...stripeOpsMeta(err),
      });
      return null;
    }
    throw err;
  }
}

async function retrieveV2CoreAccount(accountId: string): Promise<unknown | null> {
  if (retrieveV2CoreAccountFn) return retrieveV2CoreAccountFn(accountId);
  if (retrieveV2AppliedConfigurationsFn) return null;
  if (createV2AccountFn || createV2AccountLinkFn || createAccountFn) return null;
  if (isSyntheticConnectAccountId(accountId)) return null;
  if (!isStripeConfigured()) return null;
  try {
    return await getStripeClient().rawRequest(
      "GET",
      accountsV2RetrievePathWithIncludes(accountId),
      null as unknown as { [key: string]: unknown },
      accountsV2GetRequestOptions(),
    );
  } catch (err) {
    if (isStripeAccountUnreachable(err)) {
      console.info("[stripe.connect] v2.accounts.retrieve_not_found", {
        accountSuffix: accountId.slice(-8),
        ...stripeOpsMeta(err),
      });
      return null;
    }
    throw err;
  }
}

/**
 * Prefer Accounts V2 capability status; fall back to V1 Account fields.
 * Returns null when Stripe cannot be reached — callers keep the last DB mirror.
 */
export async function retrieveConnectCapabilitySnapshot(
  accountId: string,
): Promise<ConnectCapabilitySnapshot | null> {
  const trimmed = accountId.trim();
  if (!isStripeConnectedAccountId(trimmed)) return null;

  let v2Snap: ConnectCapabilitySnapshot | null = null;
  try {
    const v2 = await retrieveV2CoreAccount(trimmed);
    if (v2 && typeof v2 === "object") {
      const objectType = (v2 as { object?: unknown }).object;
      const hasConfigs = Array.isArray((v2 as { applied_configurations?: unknown }).applied_configurations);
      if (objectType === "v2.core.account" || hasConfigs) {
        v2Snap = snapshotFromV2CoreAccount(v2);
        if (isConnectCapabilityReady(v2Snap)) return v2Snap;
      }
    }
  } catch (err) {
    logServerError("stripeConnect.v2.accounts.retrieve.status", err, {
      accountSuffix: trimmed.slice(-8),
      ...stripeOpsMeta(err),
    });
  }

  if (createAccountFn && !retrieveAccountFn) return v2Snap;
  if (isSyntheticConnectAccountId(trimmed) && !retrieveAccountFn) return v2Snap;

  try {
    const v1 = await retrieveConnectedAccount(trimmed);
    if (!v1?.id) return v2Snap;
    const v1Snap = snapshotFromStripeAccount(v1);
    if (isConnectCapabilityReady(v1Snap)) return v1Snap;
    return v2Snap ?? v1Snap;
  } catch (err) {
    if (isStripeAccountUnreachable(err)) return v2Snap;
    logServerError("stripeConnect.accounts.retrieve.status", err, {
      accountSuffix: trimmed.slice(-8),
      ...stripeOpsMeta(err),
    });
    return v2Snap;
  }
}

/**
 * Re-read Stripe and persist the CareTip Connect mirror.
 * Does not create accounts. Never trusts client-supplied account IDs.
 */
export async function refreshConnectStatusFromStripe(businessId: string): Promise<{
  refreshed: boolean;
  source: "v2" | "v1" | "none";
}> {
  const trimmed = businessId.trim();
  if (!trimmed) return { refreshed: false, source: "none" };

  const business = await prisma.business.findUnique({
    where: { id: trimmed },
    select: CONNECT_SELECT,
  });
  if (!business?.stripeAccountId?.trim()) {
    return { refreshed: false, source: "none" };
  }

  const accountId = business.stripeAccountId.trim();
  const snap = await retrieveConnectCapabilitySnapshot(accountId);
  if (!snap) return { refreshed: false, source: "none" };

  const acceptedAt = new Date();
  const updated = await prisma.business.updateMany({
    where: { id: business.id, stripeAccountId: accountId },
    data: connectStatusDataFromSnap(snap, acceptedAt),
  });
  if (updated.count !== 1) return { refreshed: false, source: "none" };

  console.info("[stripe.connect] status_refreshed", {
    businessId: business.id,
    accountSuffix: accountId.slice(-8),
    previousStatus: business.stripeConnectStatus,
    nextStatus: snap.status,
    chargesEnabled: snap.chargesEnabled,
    payoutsEnabled: snap.payoutsEnabled,
    requirementsDue: snap.currentlyDueCount,
  });
  return { refreshed: true, source: snap.chargesEnabled || snap.payoutsEnabled ? "v2" : "v1" };
}

/**
 * Existing stripeAccountId: never create a replacement.
 * Retrieve failure → controlled error (CASE C).
 */
async function assertExistingAccountUsable(accountId: string, businessId: string): Promise<void> {
  if (createAccountFn && !retrieveAccountFn) return;
  try {
    const account = await retrieveConnectedAccount(accountId);
    if (!account?.id || account.id !== accountId) {
      logServerError("stripeConnect.accounts.retrieve", new Error("retrieved id mismatch"), {
        businessId,
        accountSuffix: accountId.slice(-8),
      });
      throw new StripeConnectError(
        CONNECT_USER_RETRIEVE_FAILED,
        "STRIPE_ACCOUNT_RETRIEVE_FAILED",
        502,
      );
    }
  } catch (err) {
    if (err instanceof StripeConnectError) throw err;
    logServerError("stripeConnect.accounts.retrieve", err, {
      businessId,
      accountSuffix: accountId.slice(-8),
      ...stripeOpsMeta(err),
      resourceMissing: isStripeResourceMissing(err),
    });
    throw new StripeConnectError(
      CONNECT_USER_RETRIEVE_FAILED,
      "STRIPE_ACCOUNT_RETRIEVE_FAILED",
      502,
    );
  }
}

async function createConnectedAccountForBusiness(input: {
  businessId: string;
  managerEmail: string;
  displayName: string;
}): Promise<Stripe.Account> {
  const options: Stripe.RequestOptions = {
    idempotencyKey: connectExpressIdempotencyKey(input.businessId),
  };

  if (createAccountFn) {
    return createAccountFn(
      {
        type: "express",
        country: connectDefaultCountry(),
        email: input.managerEmail.trim() || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: { name: input.displayName.slice(0, 100) },
        metadata: { caretip_business_id: input.businessId },
      },
      options,
    );
  }

  const v2Params = buildAccountsV2CreateParams({
    country: connectDefaultCountry(),
    contactEmail: input.managerEmail,
    displayName: input.displayName,
    businessId: input.businessId,
  });

  let created: unknown;
  try {
    if (createV2AccountFn) {
      created = await createV2AccountFn(v2Params, options);
    } else {
      created = await getStripeClient().rawRequest(
        "POST",
        STRIPE_ACCOUNTS_V2_CREATE_PATH,
        v2Params,
        accountsV2RequestOptions(v2Params, options),
      );
    }
  } catch (err) {
    logServerError("stripeConnect.v2.accounts.create", err, {
      businessId: input.businessId,
      ...stripeOpsMeta(err),
    });
    throw new StripeConnectError(CONNECT_USER_CREATE_FAILED, "STRIPE_ACCOUNT_CREATE_FAILED", 502);
  }

  const accountId = parseV2CreatedAccountId(created);

  try {
    return await retrieveConnectedAccount(accountId);
  } catch (err) {
    logServerError("stripeConnect.accounts.retrieve.afterCreate", err, {
      businessId: input.businessId,
      accountSuffix: accountId.slice(-8),
      ...stripeOpsMeta(err),
    });
    return pendingOnboardingSnapshot(accountId);
  }
}

/** When false, skip in-process serialization (Phase 1.6 concurrent CAS tests). */
let serializeConnectEnsure = true;

export function __setSerializeConnectEnsureForTests(enabled: boolean): void {
  serializeConnectEnsure = enabled;
}

/**
 * Ensure an Express Connected Account exists for this business (idempotent + race-safe).
 * Never accepts client acct ids. Never overwrites an existing stripeAccountId.
 */
export async function ensureExpressConnectedAccountForBusiness(params: {
  businessId: string;
  managerEmail: string;
}): Promise<{ accountId: string; created: boolean }> {
  if (!isStripeConfigured() && !createAccountFn && !createV2AccountFn) {
    throw new StripeConnectError(
      "Payment processing is not configured yet.",
      "STRIPE_NOT_CONFIGURED",
      503,
    );
  }

  const businessId = params.businessId.trim();
  const run = async (): Promise<{ accountId: string; created: boolean }> => {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: CONNECT_SELECT,
    });
    if (!business) {
      throw new StripeConnectError("Business not found", "BUSINESS_NOT_FOUND", 404);
    }

    assertBusinessMayMutateConnect(business);

    const existing = business.stripeAccountId?.trim();
    if (existing) {
      if (!isStripeConnectedAccountId(existing)) {
        logServerError("stripeConnect.existingAccountMalformed", new Error("stored id rejected"), {
          businessId: business.id,
        });
        throw new StripeConnectError(
          CONNECT_USER_RETRIEVE_FAILED,
          "STRIPE_ACCOUNT_RETRIEVE_FAILED",
          502,
        );
      }
      await assertExistingAccountUsable(existing, business.id);
      return { accountId: existing, created: false };
    }

    let account: Stripe.Account;
    try {
      account = await createConnectedAccountForBusiness({
        businessId: business.id,
        managerEmail: params.managerEmail,
        displayName: business.name,
      });
    } catch (err) {
      if (err instanceof StripeConnectError) throw err;
      logServerError("stripeConnect.v2.accounts.create", err, {
        businessId: business.id,
        ...stripeOpsMeta(err),
      });
      throw new StripeConnectError(CONNECT_USER_CREATE_FAILED, "STRIPE_ACCOUNT_CREATE_FAILED", 502);
    }

    if (!account.id || !isStripeConnectedAccountId(account.id)) {
      throw new StripeConnectError(CONNECT_USER_CREATE_FAILED, "STRIPE_ACCOUNT_CREATE_FAILED", 502);
    }

    const snap = snapshotFromStripeAccount(account);
    const acceptedAt =
      typeof account.created === "number" && account.created > 0
        ? new Date(account.created * 1000)
        : new Date();

    // Compare-and-set: bind only if still null — never overwrite an existing acct_.
    let boundCount = 0;
    try {
      const bound = await prisma.business.updateMany({
        where: { id: business.id, stripeAccountId: null },
        data: connectStatusDataFromSnap(snap, acceptedAt, account.id),
      });
      boundCount = bound.count;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        logServerError("stripeConnect.persistAccount.tenantConflict", err, {
          businessId: business.id,
          createdAccountSuffix: account.id.slice(-8),
        });
        throw new StripeConnectError(
          CONNECT_USER_TENANT_CONFLICT,
          "STRIPE_ACCOUNT_TENANT_CONFLICT",
          409,
        );
      }
      throw err;
    }

    if (boundCount === 1) {
      return { accountId: account.id, created: true };
    }

    const again = await prisma.business.findUnique({
      where: { id: business.id },
      select: { stripeAccountId: true },
    });
    const stored = again?.stripeAccountId?.trim();
    if (stored) {
      if (stored !== account.id) {
        console.warn("[stripe.connect] express_account_not_bound_cas_lost", {
          businessId: business.id,
          createdAccountSuffix: account.id.slice(-8),
          storedAccountSuffix: stored.slice(-8),
        });
      }
      return { accountId: stored, created: false };
    }

    logServerError("stripeConnect.persistAccount", new Error("CAS bind failed with null stored"), {
      businessId: business.id,
      createdAccountSuffix: account.id.slice(-8),
    });
    throw new StripeConnectError(
      "Could not save Stripe Connect account. Please try again.",
      "STRIPE_ACCOUNT_PERSIST_FAILED",
      500,
    );
  };

  if (!serializeConnectEnsure) return run();
  return runSerializedByKey(`stripe_connect_ensure:${businessId}`, run);
}

function isConfigsMustMatchAccountLinkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && code.includes("configs_must_match")) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" && message.includes("configs_must_match");
}

function shouldFallbackToV1AccountLink(err: unknown): boolean {
  if (!err || typeof err !== "object") return true;
  if (isConfigsMustMatchAccountLinkError(err)) return false;
  const status = (err as { statusCode?: unknown }).statusCode;
  if (status === 401 || status === 403) return false;
  return true;
}

async function createV1AccountOnboardingLinkUrl(input: {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<string> {
  const link = await getStripeClient().accountLinks.create({
    account: input.accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: "account_onboarding",
  });
  if (!link.url?.trim()) {
    throw new StripeConnectError(
      "Could not open Stripe onboarding. Please try again.",
      "STRIPE_ACCOUNT_LINK_EMPTY",
      502,
    );
  }
  return link.url.trim();
}

async function createOnboardingLinkUrl(input: {
  accountId: string;
  businessId: string;
  refreshUrl: string;
  returnUrl: string;
}): Promise<string> {
  // Phase 1.6 V1 mock path — do not call Accounts V2 Account Links.
  if (createAccountFn && !createV2AccountFn && !createV2AccountLinkFn) {
    return createV1AccountOnboardingLinkUrl(input);
  }

  let applied: string[] | null;
  try {
    applied = await retrieveV2AppliedConfigurations(input.accountId);
  } catch (err) {
    logServerError("stripeConnect.v2.accounts.retrieve", err, {
      businessId: input.businessId,
      accountSuffix: input.accountId.slice(-8),
      ...stripeOpsMeta(err),
    });
    throw new StripeConnectError(
      "Could not open Stripe onboarding. Please try again.",
      "STRIPE_ACCOUNT_LINK_RETRIEVE_FAILED",
      502,
    );
  }

  // Legacy Express (not in Accounts V2) — supported V1 Account Link fallback.
  if (applied === null) {
    console.info("[stripe.connect] account_link.v1_fallback", {
      businessId: input.businessId,
      accountSuffix: input.accountId.slice(-8),
      reason: "v2_account_not_found",
    });
    try {
      return await createV1AccountOnboardingLinkUrl(input);
    } catch (err) {
      if (err instanceof StripeConnectError) throw err;
      logServerError("stripeConnect.accountLinks.create", err, {
        businessId: input.businessId,
        accountSuffix: input.accountId.slice(-8),
        ...stripeOpsMeta(err),
      });
      throw new StripeConnectError(
        "Could not open Stripe onboarding. Please try again.",
        "STRIPE_ACCOUNT_LINK_FAILED",
        502,
      );
    }
  }

  const v2Params = buildAccountsV2AccountLinkParams({
    accountId: input.accountId,
    refreshUrl: input.refreshUrl,
    returnUrl: input.returnUrl,
    configurations: applied,
  });

  try {
    let payload: unknown;
    if (createV2AccountLinkFn) {
      payload = await createV2AccountLinkFn(v2Params, accountsV2RequestOptions(v2Params));
    } else if (isStripeConfigured()) {
      console.info("[stripe.connect] v2.account_links.create", {
        businessId: input.businessId,
        accountSuffix: input.accountId.slice(-8),
        configurations: applied,
      });
      payload = await getStripeClient().rawRequest(
        "POST",
        STRIPE_ACCOUNTS_V2_ACCOUNT_LINKS_PATH,
        v2Params,
        accountsV2RequestOptions(v2Params),
      );
    } else {
      throw new StripeConnectError(
        "Payment processing is not configured yet.",
        "STRIPE_NOT_CONFIGURED",
        503,
      );
    }
    return parseV2AccountLinkUrl(payload);
  } catch (err) {
    if (err instanceof StripeConnectError) throw err;
    logServerError("stripeConnect.v2.account_links.create", err, {
      businessId: input.businessId,
      accountSuffix: input.accountId.slice(-8),
      ...stripeOpsMeta(err),
      configsMustMatch: isConfigsMustMatchAccountLinkError(err),
    });
    // V2 accounts: never conceal a configuration mismatch (or other V2 link failure) with V1.
    throw new StripeConnectError(
      "Could not open Stripe onboarding. Please try again.",
      "STRIPE_ACCOUNT_LINK_FAILED",
      502,
    );
  }
}

/**
 * Create a Stripe-hosted Express Account Link. Return/refresh URLs are server-fixed.
 * V2 Account Links use the account's actual applied_configurations.
 * Legacy Express accounts (not in V2) fall back to V1 Account Links.
 */
export async function createExpressAccountOnboardingLink(params: {
  businessId: string;
  managerEmail: string;
}): Promise<{ url: string; accountId: string }> {
  const business = await prisma.business.findUnique({
    where: { id: params.businessId },
    select: { deletedAt: true, legalHold: true },
  });
  if (!business) {
    throw new StripeConnectError("Business not found", "BUSINESS_NOT_FOUND", 404);
  }
  assertBusinessMayMutateConnect(business);

  const { accountId } = await ensureExpressConnectedAccountForBusiness(params);
  if (!isStripeConfigured() && !createAccountFn && !createV2AccountFn && !createV2AccountLinkFn) {
    throw new StripeConnectError(
      "Payment processing is not configured yet.",
      "STRIPE_NOT_CONFIGURED",
      503,
    );
  }

  const base = frontendBaseUrl();
  const refreshUrl = `${base}/dashboard/stripe/connect?connect=refresh`;
  const returnUrl = `${base}/dashboard/stripe/connect?connect=return`;

  const url = await createOnboardingLinkUrl({
    accountId,
    businessId: params.businessId,
    refreshUrl,
    returnUrl,
  });

  return { url, accountId };
}

export async function getConnectStatusForBusiness(businessId: string): Promise<ConnectStatusDto> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: CONNECT_SELECT,
  });
  if (!business) {
    throw new StripeConnectError("Business not found", "BUSINESS_NOT_FOUND", 404);
  }
  return toStatusDto(business);
}

/**
 * Sync Connect status from a verified Stripe `account.updated` object.
 * Looks up Business solely by stored stripeAccountId — never by client businessId.
 * Ignores stale events older than the last accepted Stripe event timestamp.
 */
export async function handleConnectAccountUpdated(
  account: Stripe.Account,
  opts?: { eventCreatedUnix?: number },
): Promise<{
  matched: boolean;
  businessId: string | null;
  skippedStale?: boolean;
}> {
  const accountId = account.id?.trim();
  if (!accountId) {
    console.warn("[stripe.connect] account.updated missing account id");
    return { matched: false, businessId: null };
  }

  const business = await prisma.business.findFirst({
    where: { stripeAccountId: accountId },
    select: { id: true, stripeConnectUpdatedAt: true },
  });

  if (!business) {
    console.info("[stripe.connect] account.updated unmatched", {
      accountSuffix: accountId.slice(-8),
    });
    return { matched: false, businessId: null };
  }

  const eventCreatedUnix =
    opts?.eventCreatedUnix ??
    (typeof account.created === "number" && account.created > 0 ? account.created : undefined);

  if (
    eventCreatedUnix != null &&
    !shouldAcceptConnectAccountEvent({
      eventCreatedUnix,
      lastAcceptedAt: business.stripeConnectUpdatedAt,
    })
  ) {
    console.info("[stripe.connect] account.updated stale_skipped", {
      businessId: business.id,
      accountSuffix: accountId.slice(-8),
      eventCreatedUnix,
      lastAcceptedAt: business.stripeConnectUpdatedAt?.toISOString() ?? null,
    });
    return { matched: true, businessId: business.id, skippedStale: true };
  }

  const snapFromEvent = snapshotFromStripeAccount(account);
  let snap = snapFromEvent;
  if (snap.status !== StripeConnectStatus.ready) {
    try {
      const v2 = await retrieveV2CoreAccount(accountId);
      if (v2) {
        const live = snapshotFromV2CoreAccount(v2);
        if (isConnectCapabilityReady(live)) {
          snap = live;
          console.info("[stripe.connect] account.updated upgraded_from_v2", {
            businessId: business.id,
            accountSuffix: accountId.slice(-8),
          });
        }
      }
    } catch (err) {
      logServerError("stripeConnect.account.updated.live_upgrade", err, {
        businessId: business.id,
        accountSuffix: accountId.slice(-8),
        ...stripeOpsMeta(err),
      });
    }
  }
  const acceptedAt =
    eventCreatedUnix != null && eventCreatedUnix > 0
      ? new Date(eventCreatedUnix * 1000)
      : new Date();

  // Second CAS: only apply if still same account and not overwritten by a newer accepted event.
  const updated = await prisma.business.updateMany({
    where: {
      id: business.id,
      stripeAccountId: accountId,
      OR: [
        { stripeConnectUpdatedAt: null },
        { stripeConnectUpdatedAt: { lte: acceptedAt } },
      ],
    },
    data: connectStatusDataFromSnap(snap, acceptedAt),
  });

  if (updated.count === 0) {
    console.info("[stripe.connect] account.updated race_or_stale_skipped", {
      businessId: business.id,
      accountSuffix: accountId.slice(-8),
    });
    return { matched: true, businessId: business.id, skippedStale: true };
  }

  return { matched: true, businessId: business.id, skippedStale: false };
}

/** Exported for tests. */
export const __test = {
  deriveStripeConnectStatus,
  snapshotFromStripeAccount,
  connectDefaultCountry,
  frontendBaseUrl,
  connectExpressIdempotencyKey,
  shouldAcceptConnectAccountEvent,
  buildAccountsV2CreateParams,
  buildAccountsV2AccountLinkParams,
  accountsV2RequestOptions,
  accountsV2GetRequestOptions,
  v2JsonUtf8ContentLength,
  snapshotFromV2CoreAccount,
  isConnectCapabilityReady,
  retrieveConnectCapabilitySnapshot,
  refreshConnectStatusFromStripe,
  accountsV2RetrievePathWithIncludes,
  __setRetrieveV2CoreAccountFnForTests,
  __setCreateAccountFnForTests,
  __setCreateV2AccountFnForTests,
  __setCreateV2AccountLinkFnForTests,
  __setRetrieveAccountFnForTests,
  __setRetrieveV2AppliedConfigurationsFnForTests,
  __setSerializeConnectEnsureForTests,
  shouldFallbackToV1AccountLink,
};
