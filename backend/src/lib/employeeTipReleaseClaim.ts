/**
 * Durable release-operation state in employee_tip_payables.last_transfer_error.
 * Survives Supabase transaction pooler (row state, not session advisory locks).
 *
 * States:
 * - rel_claim:1:{expiresMs}:{token}  — worker owns the release attempt
 * - rel_inflight:1:{token}:{startedMs} — transfers.create may be in flight (longer TTL than claim)
 */
import { randomBytes } from "node:crypto";
import {
  EMPLOYEE_TIP_RELEASE_IN_FLIGHT_TTL_MS,
  EMPLOYEE_TIP_RELEASE_PROCESSING_CLAIM_TTL_MS,
} from "../config/employeeTipReleaseRecovery.config.js";

const CLAIM_PREFIX = "rel_claim:1:";
const INFLIGHT_PREFIX = "rel_inflight:1:";
/** Survives new claims until transfer persisted or definite failure clears it. */
export const DURABLE_RELEASE_BLOCK_PREFIX = "rel_durable:1:";
export const DURABLE_OPERATIONAL_SEP = "|";

export function operationalReleaseMarker(
  lastTransferError: string | null | undefined,
): string | null {
  const raw = lastTransferError?.trim();
  if (!raw) return null;
  const sep = raw.indexOf(DURABLE_OPERATIONAL_SEP);
  if (sep >= 0) return raw.slice(sep + 1).trim() || null;
  if (raw.startsWith(DURABLE_RELEASE_BLOCK_PREFIX)) return null;
  return raw;
}

export function extractDurableReleaseSegment(
  lastTransferError: string | null | undefined,
): string | null {
  const raw = lastTransferError?.trim();
  if (!raw?.startsWith(DURABLE_RELEASE_BLOCK_PREFIX)) return null;
  const sep = raw.indexOf(DURABLE_OPERATIONAL_SEP);
  if (sep < 0) return raw.slice(0, 180);
  return raw.slice(0, sep).slice(0, 180);
}

export function parseDurableReleaseBlockDetail(
  lastTransferError: string | null | undefined,
): string | null {
  const segment = extractDurableReleaseSegment(lastTransferError);
  if (!segment) return null;
  return segment.slice(DURABLE_RELEASE_BLOCK_PREFIX.length) || null;
}

export function formatDurableReleaseBlock(kind: string, detail?: string): string {
  const body = detail ? `${kind}:${detail}` : kind;
  return `${DURABLE_RELEASE_BLOCK_PREFIX}${body}`.slice(0, 80);
}

export function mergeDurableWithOperationalMarker(
  durableSegment: string | null,
  operationalMarker: string,
): string {
  if (!durableSegment) return operationalMarker.slice(0, 180);
  return `${durableSegment}${DURABLE_OPERATIONAL_SEP}${operationalMarker}`.slice(0, 180);
}

/** Blocks transfers.create until lookup reconciles or definite failure clears the row. */
export function employeeTipReleaseCreateBlockedByDurableState(
  lastTransferError: string | null | undefined,
): boolean {
  return parseDurableReleaseBlockDetail(lastTransferError) != null;
}

const LEGACY_POST_RECLAIM_UNCERTAIN_RE =
  /^ops_uncertain:[^:]+:post_reclaim_empty_lookup(?::|$)/;

/** Pre–rel_durable rows that must remain create-blocked. */
export function isLegacyPostReclaimUncertaintyMarker(
  lastTransferError: string | null | undefined,
): boolean {
  const raw = lastTransferError?.trim();
  if (!raw || employeeTipReleaseCreateBlockedByDurableState(raw)) return false;
  return LEGACY_POST_RECLAIM_UNCERTAIN_RE.test(raw);
}

/** ops_uncertain mentioning post_reclaim but not matching the known legacy shape — fail closed. */
export function isMalformedLegacyPostReclaimMarker(
  lastTransferError: string | null | undefined,
): boolean {
  const raw = lastTransferError?.trim();
  if (!raw || employeeTipReleaseCreateBlockedByDurableState(raw)) return false;
  if (!raw.startsWith("ops_uncertain:")) return false;
  if (!raw.includes("post_reclaim")) return false;
  return !LEGACY_POST_RECLAIM_UNCERTAIN_RE.test(raw);
}

export function legacyPostReclaimUpgradeDurableSegment(
  lastTransferError: string | null | undefined,
): string | null {
  if (!isLegacyPostReclaimUncertaintyMarker(lastTransferError)) return null;
  const raw = lastTransferError!.trim();
  const detail = raw.includes(":")
    ? raw.split(":").slice(3).join(":").slice(0, 40) || "legacy_migrated"
    : "legacy_migrated";
  return formatDurableReleaseBlock("post_reclaim_empty_lookup", detail);
}

/** Atomic legacy upgrade value — preserves active claim/inflight operational tail. */
export function mergeLegacyPostReclaimToDurableMarker(
  lastTransferError: string | null | undefined,
): string | null {
  const durable = legacyPostReclaimUpgradeDurableSegment(lastTransferError);
  if (!durable) return null;
  const op = operationalReleaseMarker(lastTransferError);
  if (!op) return durable;
  return mergeDurableWithOperationalMarker(durable, op);
}

/**
 * Durable blocks cleared only by successful transfer persist or ownership-fenced definite failure.
 * Ordinary errors (e.g. card_declined) are retriable and are not durable uncertainty.
 */
export function isOrdinaryDefiniteTransferFailureMarker(
  lastTransferError: string | null | undefined,
): boolean {
  const raw = lastTransferError?.trim();
  if (!raw) return false;
  if (releaseCreateBlockedByStoredMarker(raw)) return false;
  if (
    raw.startsWith("rel_") ||
    raw.startsWith("ops_") ||
    raw.startsWith("manual_")
  ) {
    return false;
  }
  return true;
}

/** Prefer orphan_suspected evidence over weaker post-reclaim blocks. */
export function mergeDurableBlockForLookupBlock(
  current: string | null | undefined,
  kind: string,
  detail: string,
): string {
  const existingDetail = parseDurableReleaseBlockDetail(current);
  if (existingDetail?.startsWith("orphan_suspected:")) {
    const segment = extractDurableReleaseSegment(current);
    if (segment) return segment;
  }
  return formatDurableReleaseBlock(kind, detail);
}

export function releaseCreateBlockedByStoredMarker(
  lastTransferError: string | null | undefined,
): boolean {
  return (
    employeeTipReleaseCreateBlockedByDurableState(lastTransferError) ||
    isLegacyPostReclaimUncertaintyMarker(lastTransferError) ||
    isMalformedLegacyPostReclaimMarker(lastTransferError)
  );
}

/** Keep rel_durable (and legacy post-reclaim) markers when refund/dispute paths update the row. */
export function preserveDurableReleaseMarker(
  current: string | null | undefined,
  proposed: string | null,
): string | null {
  if (releaseCreateBlockedByStoredMarker(current)) {
    return current ?? proposed;
  }
  return proposed;
}

export type ParsedReleaseClaim = {
  expiresAtMs: number;
  token: string;
};

export type ParsedStripeTransferInFlight = {
  token: string;
  startedAtMs: number;
};

export function formatEmployeeTipReleaseClaim(expiresAtMs: number, token: string): string {
  return `${CLAIM_PREFIX}${expiresAtMs}:${token}`.slice(0, 180);
}

export function formatEmployeeTipStripeTransferInFlight(token: string, startedAtMs: number): string {
  return `${INFLIGHT_PREFIX}${token}:${startedAtMs}`.slice(0, 180);
}

export function parseEmployeeTipReleaseClaim(
  lastTransferError: string | null | undefined,
): ParsedReleaseClaim | null {
  const raw = operationalReleaseMarker(lastTransferError);
  if (!raw?.startsWith(CLAIM_PREFIX)) return null;
  const rest = raw.slice(CLAIM_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  const expiresRaw = rest.slice(0, colon);
  const token = rest.slice(colon + 1);
  const expiresAtMs = Number.parseInt(expiresRaw, 10);
  if (!Number.isFinite(expiresAtMs) || !token) return null;
  return { expiresAtMs, token };
}

export function parseEmployeeTipStripeTransferInFlight(
  lastTransferError: string | null | undefined,
): ParsedStripeTransferInFlight | null {
  const raw = operationalReleaseMarker(lastTransferError);
  if (!raw?.startsWith(INFLIGHT_PREFIX)) return null;
  const rest = raw.slice(INFLIGHT_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  const token = rest.slice(0, colon);
  const startedRaw = rest.slice(colon + 1);
  const startedAtMs = Number.parseInt(startedRaw, 10);
  if (!Number.isFinite(startedAtMs) || !token) return null;
  return { token, startedAtMs };
}

export function releaseOperationToken(
  lastTransferError: string | null | undefined,
): string | null {
  return (
    parseEmployeeTipStripeTransferInFlight(lastTransferError)?.token ??
    parseEmployeeTipReleaseClaim(lastTransferError)?.token ??
    null
  );
}

export function isActiveEmployeeTipReleaseClaim(
  lastTransferError: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  const claim = parseEmployeeTipReleaseClaim(lastTransferError);
  if (!claim) return false;
  return claim.expiresAtMs > nowMs;
}

/** Stripe request may still be in flight — blocks reclaim and second create. */
export function isActiveEmployeeTipStripeTransferInFlight(
  lastTransferError: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  const inflight = parseEmployeeTipStripeTransferInFlight(lastTransferError);
  if (!inflight) return false;
  return nowMs - inflight.startedAtMs < EMPLOYEE_TIP_RELEASE_IN_FLIGHT_TTL_MS;
}

export function isExpiredEmployeeTipStripeTransferInFlight(
  lastTransferError: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  const inflight = parseEmployeeTipStripeTransferInFlight(lastTransferError);
  if (!inflight) return false;
  return nowMs - inflight.startedAtMs >= EMPLOYEE_TIP_RELEASE_IN_FLIGHT_TTL_MS;
}

export function newEmployeeTipReleaseClaimToken(): string {
  return randomBytes(8).toString("hex");
}

export function newEmployeeTipReleaseClaimExpiry(nowMs = Date.now()): number {
  return nowMs + EMPLOYEE_TIP_RELEASE_PROCESSING_CLAIM_TTL_MS;
}

/** Ops / uncertainty markers fenced by token when possible. */
export function formatEmployeeTipReleaseOpsState(
  kind: string,
  token: string,
  detail: string,
): string {
  return `ops_${kind}:${token}:${detail}`.slice(0, 180);
}

export function operationTokenMatches(
  lastTransferError: string | null | undefined,
  token: string,
): boolean {
  return releaseOperationToken(lastTransferError) === token;
}
