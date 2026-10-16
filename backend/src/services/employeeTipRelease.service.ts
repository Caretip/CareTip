/**
 * Release platform-held employee payables after the recipient account is ready.
 * Idempotent: unique transactionId, unique stripeTransferId, Stripe idempotency key.
 */
import Stripe from "stripe";
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  EmployeeTipPayoutMode,
  Prisma,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { logServerError } from "../utils/httpErrors.js";
import {
  baseEmployeeTipReleaseIdempotencyKey,
  buildEmployeeTipReleaseIdempotencyKey,
  formatStripeTransferError,
  isDefiniteEmployeeTipTransferError,
  isUncertainEmployeeTipTransferError,
} from "../lib/stripeTransferError.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import {
  employeePayableSummaryForEmployee,
  remainingPayableCents,
} from "./employeeTipPayable.service.js";
import { isEmployeeRecipientReady } from "./employeeTipRouting.service.js";
import { employeeTipTransferringStaleAlertThresholdMs } from "../config/employeeTipReleaseRecovery.config.js";
import {
  employeeTipReleaseRequiresStripeTransferLookup,
  findStripeTransfersForEmployeeTipPayable,
} from "./employeeTipReleaseTransferLookup.service.js";
import {
  employeeTipReleaseCreateBlockedByDurableState,
  extractDurableReleaseSegment,
  formatDurableReleaseBlock,
  isLegacyPostReclaimUncertaintyMarker,
  isMalformedLegacyPostReclaimMarker,
  legacyPostReclaimUpgradeDurableSegment,
  mergeDurableBlockForLookupBlock,
  mergeLegacyPostReclaimToDurableMarker,
  operationalReleaseMarker,
  releaseCreateBlockedByStoredMarker,
  formatEmployeeTipReleaseClaim,
  formatEmployeeTipReleaseOpsState,
  formatEmployeeTipStripeTransferInFlight,
  isActiveEmployeeTipReleaseClaim,
  isActiveEmployeeTipStripeTransferInFlight,
  isExpiredEmployeeTipStripeTransferInFlight,
  mergeDurableWithOperationalMarker,
  newEmployeeTipReleaseClaimExpiry,
  newEmployeeTipReleaseClaimToken,
  operationTokenMatches,
  parseEmployeeTipReleaseClaim,
  parseEmployeeTipStripeTransferInFlight,
} from "../lib/employeeTipReleaseClaim.js";
import { recordEmployeeTipStripeCreateAudit } from "../lib/employeeTipReleaseStripeCreateAudit.js";
import { readFileSync, existsSync } from "node:fs";

export { buildEmployeeTipReleaseIdempotencyKey } from "../lib/stripeTransferError.js";
export {
  __setEmployeeTipReleaseTransferListFnForTests,
  findStripeTransfersForEmployeeTipPayable,
  employeeTipReleaseRequiresStripeTransferLookup,
} from "./employeeTipReleaseTransferLookup.service.js";

/**
 * Fire-and-forget release when recoverable platform-hold payables exist and
 * the employee Connect account is recipient-ready. Safe to call from status
 * polls and payout-history loads — serialized per employee, idempotent keys.
 */
export function scheduleReleaseRecoverablePlatformPayablesForEmployee(
  employeeId: string,
): void {
  if (!employeeId.trim() || !isStripeConfigured()) return;
  void (async () => {
    const summary = await employeePayableSummaryForEmployee(employeeId);
    if (summary.heldPlatformCents <= 0) return;
    const account = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId },
      select: {
        stripeAccountId: true,
        stripeConnectStatus: true,
        stripePayoutsEnabled: true,
        employee: { select: { isDeleted: true, isActive: true, activationStatus: true } },
      },
    });
    if (!account || !isEmployeeRecipientReady(account)) return;
    if (
      account.employee.isDeleted ||
      !account.employee.isActive ||
      account.employee.activationStatus !== "active"
    ) {
      return;
    }
    await releaseHeldPlatformPayablesForEmployee(employeeId);
  })().catch((err) => {
    logServerError("employeeTipRelease.scheduleRelease", err, { employeeId });
  });
}

type CreateTransferFn = (
  params: Stripe.TransferCreateParams,
  options: Stripe.RequestOptions,
) => Promise<Pick<Stripe.Transfer, "id" | "amount">>;
type CreateReversalFn = (
  transferId: string,
  params: Stripe.TransferReversalCreateParams,
  options: Stripe.RequestOptions,
) => Promise<Pick<Stripe.TransferReversal, "id" | "amount">>;
type RetrieveTransferFn = (transferId: string) => Promise<Pick<Stripe.Transfer, "amount_reversed">>;

type PersistTransferFn = (params: {
  payableId: string;
  transferId: string;
  amount: number;
  destinationAccountId: string;
}) => Promise<void>;

let createTransferFnForTests: CreateTransferFn | null = null;
let createReversalFnForTests: CreateReversalFn | null = null;
let retrieveTransferFnForTests: RetrieveTransferFn | null = null;
let persistTransferFnForTests: PersistTransferFn | null = null;
let createTransferBarrierFnForTests: (() => Promise<void>) | null = null;

/** Integration tests: block inside mocked transfers.create until released. */
export function __setEmployeeTipTransferCreateBarrierForTests(fn: (() => Promise<void>) | null): void {
  createTransferBarrierFnForTests = fn;
}

async function waitForEmployeeTipTransferCreateBarrier(): Promise<void> {
  const path = process.env.CARETIP_EMP_TIP_CREATE_BARRIER_FILE?.trim();
  if (createTransferBarrierFnForTests) {
    await createTransferBarrierFnForTests();
    return;
  }
  if (!path) return;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const state = readFileSync(path, "utf8").trim();
      if (state === "release") return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("employee_tip_create_barrier_timeout");
}

export function __setEmployeeTipTransferCreateFnForTests(fn: CreateTransferFn | null): void {
  createTransferFnForTests = fn;
}

export function __setEmployeeTipTransferReversalFnForTests(fn: CreateReversalFn | null): void {
  createReversalFnForTests = fn;
}

export function __setEmployeeTipTransferRetrieveFnForTests(fn: RetrieveTransferFn | null): void {
  retrieveTransferFnForTests = fn;
}

/** Test hook: simulate DB failure after Stripe transfer succeeds. */
export function __setEmployeeTipPayablePersistFnForTests(fn: PersistTransferFn | null): void {
  persistTransferFnForTests = fn;
}

async function createTransfer(
  params: Stripe.TransferCreateParams,
  options: Stripe.RequestOptions,
): Promise<Pick<Stripe.Transfer, "id" | "amount">> {
  const payableIdRaw = params.metadata?.caretip_payable_id;
  const payableId =
    typeof payableIdRaw === "string" ? payableIdRaw.trim() : payableIdRaw != null ? String(payableIdRaw) : null;
  const idempotencyKey = options.idempotencyKey?.trim() ?? "";
  await waitForEmployeeTipTransferCreateBarrier();
  if (idempotencyKey) {
    recordEmployeeTipStripeCreateAudit({ payableId, idempotencyKey });
  }
  if (createTransferFnForTests) return createTransferFnForTests(params, options);
  return getStripeClient().transfers.create(params, options);
}

export async function reverseReleasedEmployeeTransfer(params: {
  payableId: string;
  stripeTransferId: string;
  amountCents: number;
  cumulativeReversedCents: number;
}): Promise<void> {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) return;
  // An earlier attempt may have reversed in Stripe and then lost its ledger write; webhook retries
  // outlive Stripe's 24h idempotency window, so only reverse what Stripe has not reversed yet.
  const transfer = retrieveTransferFnForTests
    ? await retrieveTransferFnForTests(params.stripeTransferId)
    : createReversalFnForTests
      ? null
      : await getStripeClient().transfers.retrieve(params.stripeTransferId);
  const amount = Math.min(params.amountCents, params.cumulativeReversedCents - (transfer?.amount_reversed ?? 0));
  if (amount <= 0) return;
  const reversalParams: Stripe.TransferReversalCreateParams = {
    amount,
    metadata: { caretip_payable_id: params.payableId },
  };
  const options: Stripe.RequestOptions = {
    idempotencyKey: `emp_tip_reversal:${params.payableId}:${params.cumulativeReversedCents}`,
  };
  if (createReversalFnForTests) {
    await createReversalFnForTests(params.stripeTransferId, reversalParams, options);
    return;
  }
  await getStripeClient().transfers.createReversal(params.stripeTransferId, reversalParams, options);
}

type PayableReleaseRow = {
  id: string;
  transactionId: string;
  businessId: string;
  status: EmployeeTipPayableStatus;
  /** Status before this release attempt claimed the row (for retry idempotency keys). */
  priorStatus: EmployeeTipPayableStatus;
  updatedAt: Date;
  stripeChargeId: string | null;
  stripeTransferId: string | null;
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
  lastTransferError: string | null;
  reclaimedAfterExpiredClaim: boolean;
  releaseClaimToken: string | null;
  /** Exact last_transfer_error value when this worker acquired the claim (CAS fencing). */
  releaseClaimMarker: string | null;
  /** Durable create block surviving claim rotation (parsed from last_transfer_error). */
  durableReleaseBlock: string | null;
};

function isReleaseCreateBlocked(row: PayableReleaseRow): boolean {
  return (
    row.reclaimedAfterExpiredClaim ||
    row.durableReleaseBlock != null ||
    releaseCreateBlockedByStoredMarker(row.lastTransferError)
  );
}

const RELEASE_ELIGIBLE_STATUSES: EmployeeTipPayableStatus[] = [
  EmployeeTipPayableStatus.held_platform,
  EmployeeTipPayableStatus.transfer_failed,
  EmployeeTipPayableStatus.transferring,
];

type LockedPayableForRelease = {
  row: PayableReleaseRow;
  releaseClaimToken: string | null;
};

async function lockPayableForRelease(payableId: string): Promise<LockedPayableForRelease | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        transaction_id: string;
        business_id: string;
        status: EmployeeTipPayableStatus;
        updated_at: Date;
        stripe_charge_id: string | null;
        stripe_transfer_id: string | null;
        last_transfer_error: string | null;
        payable_cents: number;
        transferred_cents: number;
        reversed_cents: number;
        refunded_cents: number;
        disputed_open_cents: number;
        disputed_lost_cents: number;
      }>
    >(Prisma.sql`
      SELECT
        id,
        transaction_id,
        business_id,
        status,
        updated_at,
        stripe_charge_id,
        stripe_transfer_id,
        last_transfer_error,
        payable_cents,
        transferred_cents,
        reversed_cents,
        refunded_cents,
        disputed_open_cents,
        disputed_lost_cents
      FROM employee_tip_payables
      WHERE id = ${payableId}
      FOR UPDATE
    `);
    const raw = rows[0];
    if (!raw) return null;

    let lastTransferErrorForLock = raw.last_transfer_error;
    const legacyUpgrade = mergeLegacyPostReclaimToDurableMarker(raw.last_transfer_error);
    if (legacyUpgrade) {
      const upgraded = await tx.employeeTipPayable.updateMany({
        where: {
          id: payableId,
          stripeTransferId: null,
          lastTransferError: raw.last_transfer_error,
        },
        data: { lastTransferError: legacyUpgrade },
      });
      if (upgraded.count === 1) {
        lastTransferErrorForLock = legacyUpgrade;
      }
    } else if (isMalformedLegacyPostReclaimMarker(raw.last_transfer_error)) {
      const failClosed = formatDurableReleaseBlock(
        "post_reclaim_empty_lookup",
        "legacy_malformed",
      );
      const sealed = await tx.employeeTipPayable.updateMany({
        where: {
          id: payableId,
          stripeTransferId: null,
          lastTransferError: raw.last_transfer_error,
        },
        data: { lastTransferError: failClosed },
      });
      if (sealed.count === 1) {
        lastTransferErrorForLock = failClosed;
      }
    }

    let priorStatus = raw.status;
    let reclaimedAfterExpiredClaim = false;
    const row: PayableReleaseRow = {
      id: raw.id,
      transactionId: raw.transaction_id,
      businessId: raw.business_id,
      status: raw.status,
      priorStatus,
      updatedAt: raw.updated_at,
      stripeChargeId: raw.stripe_charge_id,
      stripeTransferId: raw.stripe_transfer_id,
      payableCents: raw.payable_cents,
      transferredCents: raw.transferred_cents,
      reversedCents: raw.reversed_cents,
      refundedCents: raw.refunded_cents,
      disputedOpenCents: raw.disputed_open_cents,
      disputedLostCents: raw.disputed_lost_cents,
      lastTransferError: lastTransferErrorForLock,
      reclaimedAfterExpiredClaim,
      releaseClaimToken: null,
      releaseClaimMarker: null,
      durableReleaseBlock: extractDurableReleaseSegment(lastTransferErrorForLock),
    };

    if (row.stripeTransferId) {
      return { row, releaseClaimToken: null };
    }

    if (!RELEASE_ELIGIBLE_STATUSES.includes(row.status)) {
      return null;
    }

    const nowMs = Date.now();
    if (isActiveEmployeeTipStripeTransferInFlight(lastTransferErrorForLock, nowMs)) {
      return null;
    }
    if (isActiveEmployeeTipReleaseClaim(lastTransferErrorForLock, nowMs)) {
      return null;
    }

    if (
      raw.status === EmployeeTipPayableStatus.transferring &&
      (parseEmployeeTipReleaseClaim(lastTransferErrorForLock) ||
        isExpiredEmployeeTipStripeTransferInFlight(lastTransferErrorForLock, nowMs) ||
        isLegacyPostReclaimUncertaintyMarker(lastTransferErrorForLock) ||
        isMalformedLegacyPostReclaimMarker(lastTransferErrorForLock))
    ) {
      reclaimedAfterExpiredClaim = true;
      priorStatus = EmployeeTipPayableStatus.transferring;
      row.priorStatus = priorStatus;
      row.reclaimedAfterExpiredClaim = true;
    }

    if (row.durableReleaseBlock) {
      reclaimedAfterExpiredClaim = true;
      row.reclaimedAfterExpiredClaim = true;
    }

    const claimToken = newEmployeeTipReleaseClaimToken();
    const claimValue = formatEmployeeTipReleaseClaim(
      newEmployeeTipReleaseClaimExpiry(nowMs),
      claimToken,
    );
    const lastErrorForRow = mergeDurableWithOperationalMarker(
      row.durableReleaseBlock,
      claimValue,
    );

    const claimed = await tx.employeeTipPayable.updateMany({
      where: {
        id: payableId,
        stripeTransferId: null,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        status: { in: RELEASE_ELIGIBLE_STATUSES },
      },
      data: {
        status: EmployeeTipPayableStatus.transferring,
        lastTransferError: lastErrorForRow,
      },
    });
    if (claimed.count !== 1) {
      return null;
    }

    row.status = EmployeeTipPayableStatus.transferring;
    row.lastTransferError = lastErrorForRow;
    row.releaseClaimToken = claimToken;
    row.releaseClaimMarker = lastErrorForRow;
    return { row, releaseClaimToken: claimToken };
  });
}

async function verifyReleaseOperationHeld(
  payableId: string,
  claimToken: string | null,
): Promise<boolean> {
  if (!claimToken) return true;
  const current = await prisma.employeeTipPayable.findUnique({
    where: { id: payableId },
    select: { lastTransferError: true, stripeTransferId: true },
  });
  if (current?.stripeTransferId) return true;
  if (!operationTokenMatches(current?.lastTransferError, claimToken)) return false;
  const nowMs = Date.now();
  if (isActiveEmployeeTipStripeTransferInFlight(current?.lastTransferError, nowMs)) {
    return true;
  }
  const claim = parseEmployeeTipReleaseClaim(current?.lastTransferError);
  if (claim?.token === claimToken && claim.expiresAtMs > nowMs) return true;
  return false;
}

async function markStripeTransferInFlight(
  payableId: string,
  claimToken: string,
  claimMarker: string,
): Promise<boolean> {
  const current = await prisma.employeeTipPayable.findUnique({
    where: { id: payableId },
    select: { lastTransferError: true },
  });
  const existingInflight = parseEmployeeTipStripeTransferInFlight(current?.lastTransferError);
  if (
    existingInflight?.token === claimToken &&
    isActiveEmployeeTipStripeTransferInFlight(current?.lastTransferError)
  ) {
    return true;
  }
  const durable = extractDurableReleaseSegment(current?.lastTransferError);
  const inflight = mergeDurableWithOperationalMarker(
    durable,
    formatEmployeeTipStripeTransferInFlight(claimToken, Date.now()),
  );
  const updated = await prisma.employeeTipPayable.updateMany({
    where: {
      id: payableId,
      stripeTransferId: null,
      OR: [
        { lastTransferError: claimMarker },
        { lastTransferError: { contains: `rel_inflight:1:${claimToken}:` } },
      ],
    },
    data: { lastTransferError: inflight },
  });
  return updated.count === 1;
}

function releaseOperationOwnershipWhere(payableId: string, claimToken: string) {
  return {
    id: payableId,
    stripeTransferId: null as null,
    OR: [
      { lastTransferError: { contains: `rel_inflight:1:${claimToken}:` } },
      { lastTransferError: { endsWith: `:${claimToken}` } },
    ],
  };
}

async function persistSuccessfulEmployeeTipTransfer(params: {
  payableId: string;
  transferId: string;
  amount: number;
  destinationAccountId: string;
  releaseClaimToken?: string | null;
}): Promise<"applied" | "already_applied" | "ownership_lost"> {
  if (persistTransferFnForTests) {
    await persistTransferFnForTests(params);
    return "applied";
  }

  const ownership =
    params.releaseClaimToken != null
      ? releaseOperationOwnershipWhere(params.payableId, params.releaseClaimToken)
      : { id: params.payableId, stripeTransferId: null };

  const updated = await prisma.employeeTipPayable.updateMany({
    where: {
      ...ownership,
      chargeModel: EmployeeTipChargeModel.platform_hold,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      status: {
        in: [
          EmployeeTipPayableStatus.transferring,
          EmployeeTipPayableStatus.held_platform,
          EmployeeTipPayableStatus.transfer_failed,
        ],
      },
    },
    data: {
      status: EmployeeTipPayableStatus.transferred,
      transferredCents: params.amount,
      stripeTransferId: params.transferId,
      stripeDestinationAccountId: params.destinationAccountId,
      lastTransferError: null,
    },
  });

  if (updated.count === 1) {
    return "applied";
  }

  if (params.releaseClaimToken != null) {
    const holder = await prisma.employeeTipPayable.findUnique({
      where: { id: params.payableId },
      select: { lastTransferError: true, stripeTransferId: true, status: true },
    });
    if (
      holder?.stripeTransferId === params.transferId &&
      holder.status === EmployeeTipPayableStatus.transferred
    ) {
      return "already_applied";
    }
    if (!operationTokenMatches(holder?.lastTransferError, params.releaseClaimToken)) {
      return "ownership_lost";
    }
  }

  const existing = await prisma.employeeTipPayable.findUnique({
    where: { id: params.payableId },
    select: { stripeTransferId: true, status: true },
  });
  if (
    existing?.stripeTransferId === params.transferId &&
    existing.status === EmployeeTipPayableStatus.transferred
  ) {
    return "already_applied";
  }

  throw new Error("employee_tip_release_persist_conflict");
}

async function markUncertainTransferOutcome(
  payableId: string,
  message: string,
  claimToken?: string | null,
  opts?: { candidateTransferId?: string | null },
): Promise<void> {
  const holder = await prisma.employeeTipPayable.findUnique({
    where: { id: payableId },
    select: { lastTransferError: true },
  });
  let durable =
    extractDurableReleaseSegment(holder?.lastTransferError) ??
    legacyPostReclaimUpgradeDurableSegment(holder?.lastTransferError);
  const candidateId = opts?.candidateTransferId?.trim();
  if (candidateId && durable) {
    durable = formatDurableReleaseBlock("orphan_suspected", candidateId);
  }
  const opMessage =
    claimToken != null
      ? formatEmployeeTipReleaseOpsState("uncertain", claimToken, message)
      : message.slice(0, 180);
  const lastTransferError = durable
    ? mergeDurableWithOperationalMarker(durable, opMessage)
    : opMessage;
  const where =
    claimToken != null
      ? releaseOperationOwnershipWhere(payableId, claimToken)
      : { id: payableId, stripeTransferId: null, status: EmployeeTipPayableStatus.transferring };
  const updated = await prisma.employeeTipPayable.updateMany({
    where: { ...where, status: EmployeeTipPayableStatus.transferring },
    data: {
      status: EmployeeTipPayableStatus.transferring,
      lastTransferError,
    },
  });
  if (updated.count === 0 && claimToken != null) {
    logServerError("employeeTipRelease.uncertainOwnershipLost", new Error("ownership_lost"), {
      payableId,
      claimToken,
    });
  }
}

async function markDefiniteTransferFailure(
  payableId: string,
  message: string,
  claimToken?: string | null,
): Promise<boolean> {
  if (!claimToken) {
    logServerError("employeeTipRelease.definiteFailureNoToken", new Error("missing_claim_token"), {
      payableId,
    });
    return false;
  }
  const updated = await prisma.employeeTipPayable.updateMany({
    where: releaseOperationOwnershipWhere(payableId, claimToken),
    data: {
      status: EmployeeTipPayableStatus.transfer_failed,
      lastTransferError: message.slice(0, 180),
    },
  });
  if (updated.count !== 1) {
    logServerError("employeeTipRelease.definiteFailureOwnershipLost", new Error("ownership_lost"), {
      payableId,
      claimToken,
    });
    return false;
  }
  return true;
}

async function applyDurableReleaseBlock(
  payableId: string,
  kind: string,
  detail: string,
  claimToken: string | null,
): Promise<void> {
  const holder = await prisma.employeeTipPayable.findUnique({
    where: { id: payableId },
    select: { lastTransferError: true },
  });
  const durableSegment = mergeDurableBlockForLookupBlock(
    holder?.lastTransferError,
    kind,
    detail,
  );
  const lastTransferError = claimToken
    ? mergeDurableWithOperationalMarker(
        durableSegment,
        formatEmployeeTipReleaseOpsState("uncertain", claimToken, `${kind}:${detail}`),
      )
    : durableSegment;
  const where = claimToken
    ? releaseOperationOwnershipWhere(payableId, claimToken)
    : {
        id: payableId,
        stripeTransferId: null,
        status: EmployeeTipPayableStatus.transferring,
      };
  await prisma.employeeTipPayable.updateMany({
    where,
    data: {
      status: EmployeeTipPayableStatus.transferring,
      lastTransferError,
    },
  });
}

async function tryRecordOrphanSuspectedTransfer(
  payableId: string,
  staleClaimToken: string,
  transferId: string,
): Promise<void> {
  const durable = formatDurableReleaseBlock("orphan_suspected", transferId);
  const updated = await prisma.employeeTipPayable.updateMany({
    where: {
      id: payableId,
      stripeTransferId: null,
      OR: [
        { lastTransferError: { contains: `rel_inflight:1:${staleClaimToken}:` } },
        { lastTransferError: { endsWith: `:${staleClaimToken}` } },
      ],
    },
    data: {
      status: EmployeeTipPayableStatus.transferring,
      lastTransferError: durable,
    },
  });
  if (updated.count === 1) return;

  const fallback = await prisma.employeeTipPayable.updateMany({
    where: {
      id: payableId,
      stripeTransferId: null,
      lastTransferError: { startsWith: "rel_durable:1:" },
    },
    data: {
      status: EmployeeTipPayableStatus.transferring,
      lastTransferError: durable,
    },
  });
  if (fallback.count !== 1) {
    logServerError("employeeTipRelease.orphanSuspectedNotRecorded", new Error("ownership_lost"), {
      payableId,
      staleClaimToken,
      transferId,
    });
  }
}

async function markManualTransferReconciliation(
  payableId: string,
  code: string,
  detail: string,
  claimToken?: string | null,
): Promise<void> {
  const opMessage = claimToken
    ? formatEmployeeTipReleaseOpsState(`manual_${code}`, claimToken, detail)
    : `manual_reconcile:${code}:${detail}`.slice(0, 180);
  const where = claimToken
    ? releaseOperationOwnershipWhere(payableId, claimToken)
    : {
        id: payableId,
        stripeTransferId: null,
        status: {
          in: [
            EmployeeTipPayableStatus.transferring,
            EmployeeTipPayableStatus.transfer_failed,
            EmployeeTipPayableStatus.held_platform,
          ],
        },
      };
  const holder = await prisma.employeeTipPayable.findUnique({
    where: { id: payableId },
    select: { lastTransferError: true },
  });
  const durable = extractDurableReleaseSegment(holder?.lastTransferError);
  const lastTransferError = durable
    ? mergeDurableWithOperationalMarker(durable, opMessage)
    : opMessage;
  await prisma.employeeTipPayable.updateMany({
    where,
    data: {
      status: EmployeeTipPayableStatus.transferring,
      lastTransferError,
    },
  });
  logServerError("employeeTipRelease.manualReconcile", new Error(code), {
    payableId,
    detail,
  });
}

async function markLookupBlockedOutcome(
  payableId: string,
  code: string,
  detail: string,
  claimToken?: string | null,
  durable = false,
): Promise<void> {
  if (durable) {
    await applyDurableReleaseBlock(payableId, code, detail, claimToken ?? null);
  } else {
    await markUncertainTransferOutcome(
      payableId,
      `${code}:${detail}`,
      claimToken ?? undefined,
    );
  }
  logServerError("employeeTipRelease.lookupBlocked", new Error(code), { payableId, detail });
}

/**
 * Ops alert: transferring payables without stripeTransferId older than configured threshold.
 * Does not mutate payables.
 */
export async function warnStaleTransferringEmployeeTipPayables(limit = 25): Promise<number> {
  const cutoff = new Date(Date.now() - employeeTipTransferringStaleAlertThresholdMs());
  const rows = await prisma.employeeTipPayable.findMany({
    where: {
      chargeModel: EmployeeTipChargeModel.platform_hold,
      routingMode: EmployeeTipPayoutMode.direct_to_employee,
      status: EmployeeTipPayableStatus.transferring,
      stripeTransferId: null,
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: {
      id: true,
      employeeId: true,
      updatedAt: true,
      lastTransferError: true,
    },
  });
  for (const row of rows) {
    logServerError("employeeTipRelease.staleTransferring", new Error("stale_transferring_payable"), {
      payableId: row.id,
      employeeId: row.employeeId,
      updatedAt: row.updatedAt.toISOString(),
      lastTransferError: row.lastTransferError,
      staleAlertHours: employeeTipTransferringStaleAlertThresholdMs() / (60 * 60 * 1000),
    });
  }
  return rows.length;
}

type LookupAttemptResult =
  | { kind: "persisted" }
  | { kind: "blocked" }
  | { kind: "continue_create" };

async function attemptStripeTransferLookupBeforeCreate(
  row: PayableReleaseRow,
  employeeId: string,
  dest: string,
  amount: number,
  tryPersist: (transfer: Pick<Stripe.Transfer, "id" | "amount">) => Promise<boolean>,
  claimToken: string | null,
): Promise<LookupAttemptResult> {
  const lookup = await findStripeTransfersForEmployeeTipPayable({
    payableId: row.id,
    destinationAccountId: dest,
    employeeId,
    businessId: row.businessId,
    transactionId: row.transactionId,
    expectedAmountCents: amount,
    currency: "eur",
    stripeChargeId: row.stripeChargeId,
  });

  switch (lookup.outcome) {
    case "found": {
      const ok = await tryPersist({ id: lookup.transferId, amount: lookup.amountCents });
      return ok ? { kind: "persisted" } : { kind: "blocked" };
    }
    case "duplicate":
      await markManualTransferReconciliation(
        row.id,
        "duplicate_stripe_transfer",
        lookup.transferIds.join(",").slice(0, 100),
        claimToken,
      );
      return { kind: "blocked" };
    case "legacy_transfer_suspected":
      await markManualTransferReconciliation(
        row.id,
        "legacy_transfer_no_metadata",
        lookup.transferIds.join(",").slice(0, 100),
        claimToken,
      );
      logServerError("employeeTipRelease.legacyTransferSuspected", new Error(lookup.reason), {
        payableId: row.id,
        transferIds: lookup.transferIds,
      });
      return { kind: "blocked" };
    case "validation_failed":
      await markManualTransferReconciliation(
        row.id,
        "transfer_validation",
        `${lookup.transferId}:${lookup.reason}`,
        claimToken,
      );
      return { kind: "blocked" };
    case "lookup_incomplete":
      await markLookupBlockedOutcome(
        row.id,
        "lookup_incomplete",
        lookup.reason,
        claimToken,
        isReleaseCreateBlocked(row),
      );
      return { kind: "blocked" };
    case "lookup_failed":
      await markLookupBlockedOutcome(
        row.id,
        "lookup_failed",
        lookup.reason,
        claimToken,
        isReleaseCreateBlocked(row),
      );
      return { kind: "blocked" };
    case "not_found":
      if (!lookup.paginationComplete) {
        await markLookupBlockedOutcome(
          row.id,
          "lookup_incomplete",
          "pagination_not_complete",
          claimToken,
          isReleaseCreateBlocked(row),
        );
        return { kind: "blocked" };
      }
      if (isReleaseCreateBlocked(row)) {
        await markLookupBlockedOutcome(
          row.id,
          "post_reclaim_empty_lookup",
          "no_stripe_transfer_visible",
          claimToken,
          true,
        );
        logServerError(
          "employeeTipRelease.postReclaimBlocked",
          new Error("post_reclaim_empty_lookup"),
          { payableId: row.id },
        );
        return { kind: "blocked" };
      }
      return { kind: "continue_create" };
    default:
      await markLookupBlockedOutcome(row.id, "lookup_unknown", "unexpected", claimToken);
      return { kind: "blocked" };
  }
}

async function attemptStripeTransferWithOwnership(
  row: PayableReleaseRow,
  employeeId: string,
  dest: string,
  amount: number,
  idempotencyKey: string,
  releaseClaimToken: string | null,
): Promise<
  | { ok: true; transfer: Pick<Stripe.Transfer, "id" | "amount"> }
  | { ok: false; reason: "ownership_lost" | "inflight_mark_failed" }
> {
  if (!releaseClaimToken || !row.releaseClaimMarker) {
    return { ok: false, reason: "ownership_lost" };
  }
  if (!(await verifyReleaseOperationHeld(row.id, releaseClaimToken))) {
    return { ok: false, reason: "ownership_lost" };
  }
  const marked = await markStripeTransferInFlight(
    row.id,
    releaseClaimToken,
    row.releaseClaimMarker,
  );
  if (!marked) {
    return { ok: false, reason: "inflight_mark_failed" };
  }
  const transfer = await attemptStripeTransfer(row, employeeId, dest, amount, idempotencyKey);
  if (!(await verifyReleaseOperationHeld(row.id, releaseClaimToken))) {
    logServerError("employeeTipRelease.staleAfterStripeCreate", new Error("ownership_lost"), {
      payableId: row.id,
      employeeId,
      transferId: transfer.id,
    });
    await tryRecordOrphanSuspectedTransfer(row.id, releaseClaimToken, transfer.id);
    return { ok: false, reason: "ownership_lost" };
  }
  return { ok: true, transfer };
}

function buildTransferParams(
  row: PayableReleaseRow,
  employeeId: string,
  dest: string,
  amount: number,
): Stripe.TransferCreateParams {
  const transferParams: Stripe.TransferCreateParams = {
    amount,
    currency: "eur",
    destination: dest,
    metadata: {
      caretip_employee_id: employeeId,
      caretip_business_id: row.businessId,
      caretip_payable_id: row.id,
      caretip_transaction_id: row.transactionId,
    },
  };
  if (row.stripeChargeId?.startsWith("ch_")) {
    transferParams.source_transaction = row.stripeChargeId;
  }
  return transferParams;
}

async function attemptStripeTransfer(
  row: PayableReleaseRow,
  employeeId: string,
  dest: string,
  amount: number,
  idempotencyKey: string,
): Promise<Pick<Stripe.Transfer, "id" | "amount">> {
  return createTransfer(buildTransferParams(row, employeeId, dest, amount), { idempotencyKey });
}

/**
 * Reconcile via Stripe idempotency (same key as first attempt) before creating a new transfer.
 */
export async function reconcileEmployeeTipReleaseTransfer(params: {
  payableId: string;
  employeeId: string;
  destinationAccountId: string;
}): Promise<"reconciled" | "not_eligible" | "still_uncertain"> {
  const locked = await lockPayableForRelease(params.payableId);
  if (!locked) return "not_eligible";
  const { row, releaseClaimToken } = locked;
  if (row.stripeTransferId) return "reconciled";

  const amount = remainingPayableCents(row);
  if (amount <= 0) return "not_eligible";

  const dest = params.destinationAccountId.trim();
  const tryPersist = async (transfer: Pick<Stripe.Transfer, "id" | "amount">) => {
    try {
      const outcome = await persistSuccessfulEmployeeTipTransfer({
        payableId: row.id,
        transferId: transfer.id,
        amount,
        destinationAccountId: dest,
        releaseClaimToken,
      });
      if (outcome === "ownership_lost") return false;
      return outcome === "applied" || outcome === "already_applied";
    } catch (persistErr) {
      logServerError("employeeTipRelease.reconcile.persist", persistErr, {
        payableId: row.id,
        transferId: transfer.id,
      });
      await markUncertainTransferOutcome(
        row.id,
        "db_persist_failed_after_reconcile:" + formatStripeTransferError(persistErr),
        releaseClaimToken,
        { candidateTransferId: transfer.id },
      );
      return false;
    }
  };

  if (
    employeeTipReleaseRequiresStripeTransferLookup({
      priorStatus: row.priorStatus,
      updatedAt: row.updatedAt,
      stripeTransferId: row.stripeTransferId,
      reclaimedAfterExpiredClaim: row.reclaimedAfterExpiredClaim,
      durableReleaseBlock: row.durableReleaseBlock,
    })
  ) {
    const lookupStep = await attemptStripeTransferLookupBeforeCreate(
      row,
      params.employeeId,
      dest,
      amount,
      tryPersist,
      releaseClaimToken,
    );
    if (lookupStep.kind === "persisted") return "reconciled";
    if (lookupStep.kind === "blocked") return "still_uncertain";
  }

  if (isReleaseCreateBlocked(row)) {
    return "still_uncertain";
  }

  const baseKey = baseEmployeeTipReleaseIdempotencyKey(row.id);
  try {
    const attempt = await attemptStripeTransferWithOwnership(
      row,
      params.employeeId,
      dest,
      amount,
      baseKey,
      releaseClaimToken,
    );
    if (!attempt.ok) return "still_uncertain";
    const ok = await tryPersist(attempt.transfer);
    return ok ? "reconciled" : "still_uncertain";
  } catch (err) {
    if (isUncertainEmployeeTipTransferError(err)) {
      await markUncertainTransferOutcome(
        row.id,
        formatStripeTransferError(err),
        releaseClaimToken,
      );
      return "still_uncertain";
    }
    return "not_eligible";
  }
}

async function releaseSinglePayable(
  row: PayableReleaseRow,
  employeeId: string,
  dest: string,
  releaseClaimToken: string | null,
): Promise<"released" | "skipped" | "uncertain"> {
  if (row.stripeTransferId) {
    return "skipped";
  }

  const amount = remainingPayableCents(row);
  if (amount <= 0) {
    return "skipped";
  }

  const baseKey = baseEmployeeTipReleaseIdempotencyKey(row.id);

  const tryPersist = async (transfer: Pick<Stripe.Transfer, "id" | "amount">) => {
    try {
      const outcome = await persistSuccessfulEmployeeTipTransfer({
        payableId: row.id,
        transferId: transfer.id,
        amount,
        destinationAccountId: dest,
        releaseClaimToken,
      });
      if (outcome === "ownership_lost") return false;
      return outcome === "applied" || outcome === "already_applied";
    } catch (persistErr) {
      logServerError("employeeTipRelease.persist", persistErr, {
        payableId: row.id,
        employeeId,
        transferId: transfer.id,
        amount,
      });
      await markUncertainTransferOutcome(
        row.id,
        "db_persist_failed:" + formatStripeTransferError(persistErr),
        releaseClaimToken,
        { candidateTransferId: transfer.id },
      );
      return false;
    }
  };

  if (
    employeeTipReleaseRequiresStripeTransferLookup({
      priorStatus: row.priorStatus,
      updatedAt: row.updatedAt,
      stripeTransferId: row.stripeTransferId,
      reclaimedAfterExpiredClaim: row.reclaimedAfterExpiredClaim,
      durableReleaseBlock: row.durableReleaseBlock,
    })
  ) {
    const lookupStep = await attemptStripeTransferLookupBeforeCreate(
      row,
      employeeId,
      dest,
      amount,
      tryPersist,
      releaseClaimToken,
    );
    if (lookupStep.kind === "persisted") return "released";
    if (lookupStep.kind === "blocked") return "uncertain";
  }

  if (isReleaseCreateBlocked(row)) {
    return "uncertain";
  }

  try {
    const attempt = await attemptStripeTransferWithOwnership(
      row,
      employeeId,
      dest,
      amount,
      baseKey,
      releaseClaimToken,
    );
    if (!attempt.ok) {
      logServerError("employeeTipRelease.claimLost", new Error(attempt.reason), {
        payableId: row.id,
        employeeId,
      });
      return attempt.reason === "inflight_mark_failed" ? "uncertain" : "skipped";
    }
    const ok = await tryPersist(attempt.transfer);
    return ok ? "released" : "uncertain";
  } catch (baseErr) {
    if (isUncertainEmployeeTipTransferError(baseErr)) {
      logServerError("employeeTipRelease.transfer.uncertain", baseErr, {
        payableId: row.id,
        employeeId,
        idempotencyKey: baseKey,
      });
      await markUncertainTransferOutcome(
        row.id,
        formatStripeTransferError(baseErr),
        releaseClaimToken,
      );
      return "uncertain";
    }

    const retryKey = buildEmployeeTipReleaseIdempotencyKey(row.id, {
      status: row.priorStatus,
      updatedAt: row.updatedAt,
    });

    if (row.priorStatus === EmployeeTipPayableStatus.transfer_failed && retryKey !== baseKey) {
      const lookupBeforeRetry = await attemptStripeTransferLookupBeforeCreate(
        row,
        employeeId,
        dest,
        amount,
        tryPersist,
        releaseClaimToken,
      );
      if (lookupBeforeRetry.kind === "persisted") return "released";
      if (lookupBeforeRetry.kind === "blocked") return "uncertain";

      try {
        const retryAttempt = await attemptStripeTransferWithOwnership(
          row,
          employeeId,
          dest,
          amount,
          retryKey,
          releaseClaimToken,
        );
        if (!retryAttempt.ok) return "skipped";
        const ok = await tryPersist(retryAttempt.transfer);
        return ok ? "released" : "uncertain";
      } catch (retryErr) {
        if (isUncertainEmployeeTipTransferError(retryErr)) {
          await markUncertainTransferOutcome(
            row.id,
            formatStripeTransferError(retryErr),
            releaseClaimToken,
          );
          return "uncertain";
        }
        if (isDefiniteEmployeeTipTransferError(retryErr)) {
          const message = formatStripeTransferError(retryErr);
          logServerError("employeeTipRelease.transfer", retryErr, {
            payableId: row.id,
            employeeId,
            idempotencyKey: retryKey,
          });
          await markDefiniteTransferFailure(row.id, message, releaseClaimToken);
        }
        return "skipped";
      }
    }

    if (isDefiniteEmployeeTipTransferError(baseErr)) {
      const message = formatStripeTransferError(baseErr);
      logServerError("employeeTipRelease.transfer", baseErr, {
        payableId: row.id,
        employeeId,
        idempotencyKey: baseKey,
      });
      await markDefiniteTransferFailure(row.id, message, releaseClaimToken);
    }
    return "skipped";
  }
}

export async function releaseHeldPlatformPayablesForEmployee(employeeId: string): Promise<{
  attempted: number;
  released: number;
  skipped: number;
  uncertain: number;
}> {
  if (!employeeId.trim() || !isStripeConfigured()) {
    return { attempted: 0, released: 0, skipped: 0, uncertain: 0 };
  }

  return runSerializedByKey(`employee-tip-release:${employeeId}`, async () => {
    const account = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId },
      select: {
        stripeAccountId: true,
        stripeConnectStatus: true,
        stripePayoutsEnabled: true,
        employee: { select: { isDeleted: true, isActive: true, activationStatus: true } },
      },
    });
    if (!account || !isEmployeeRecipientReady(account)) {
      return { attempted: 0, released: 0, skipped: 0, uncertain: 0 };
    }
    if (
      account.employee.isDeleted ||
      !account.employee.isActive ||
      account.employee.activationStatus !== "active"
    ) {
      return { attempted: 0, released: 0, skipped: 0, uncertain: 0 };
    }

    const dest = account.stripeAccountId.trim();
    void warnStaleTransferringEmployeeTipPayables().catch((err) => {
      logServerError("employeeTipRelease.staleTransferringScan", err, { employeeId });
    });

    const held = await prisma.employeeTipPayable.findMany({
      where: {
        employeeId,
        chargeModel: EmployeeTipChargeModel.platform_hold,
        routingMode: EmployeeTipPayoutMode.direct_to_employee,
        status: { in: RELEASE_ELIGIBLE_STATUSES },
        stripeTransferId: null,
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: {
        id: true,
        payableCents: true,
        transferredCents: true,
        reversedCents: true,
        refundedCents: true,
        disputedOpenCents: true,
        disputedLostCents: true,
      },
    });

    let released = 0;
    let skipped = 0;
    let uncertain = 0;

    for (const row of held) {
      if (remainingPayableCents(row) <= 0) {
        skipped += 1;
        continue;
      }
      const locked = await lockPayableForRelease(row.id);
      if (!locked) {
        skipped += 1;
        continue;
      }
      const outcome = await releaseSinglePayable(
        locked.row,
        employeeId,
        dest,
        locked.releaseClaimToken,
      );
      if (outcome === "released") released += 1;
      else if (outcome === "uncertain") uncertain += 1;
      else skipped += 1;
    }

    return { attempted: held.length, released, skipped, uncertain };
  });
}

/** Integration tests only — fenced definite failure write. */
export async function __employeeTipReleaseMarkDefiniteTransferFailureForTests(
  payableId: string,
  message: string,
  claimToken: string,
): Promise<boolean> {
  return markDefiniteTransferFailure(payableId, message, claimToken);
}
