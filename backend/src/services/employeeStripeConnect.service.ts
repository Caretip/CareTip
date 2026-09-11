/**
 * Employee Stripe Connect Express (recipient) onboarding and status.
 * Checkout destination is resolved in employeeTipRouting.service.ts.
 */
import Stripe from "stripe";
import { Prisma, StripeConnectStatus, EmployeeTipPayoutMode } from "@prisma/client";
import { prisma } from "../prisma.js";
import { logServerError } from "../utils/httpErrors.js";
import { runSerializedByKey } from "../utils/serializedByKey.js";
import { writeAuditLog } from "./audit.service.js";
import { toEmployeePayoutConnectionState } from "../lib/employeePayoutConnectState.js";
import { employeePayableSummaryForEmployee } from "./employeeTipPayable.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import {
  STRIPE_ACCOUNTS_V2_CREATE_PATH,
  StripeConnectError,
  accountsV2RequestOptions,
  connectDefaultCountry,
  createConnectOnboardingLinkUrl,
  frontendBaseUrl,
  isStripeConnectedAccountId,
  retrieveConnectCapabilitySnapshot,
  shouldAcceptConnectAccountEvent,
  snapshotFromStripeAccount,
} from "./stripeConnect.service.js";

const CONNECT_USER_CREATE_FAILED = "Stripe connection couldn't be started. Please try again.";
const CONNECT_USER_LOGIN_LINK_FAILED =
  "Unable to open your Stripe Dashboard right now. Please try again.";

export type EmployeeConnectStatusDto = {
  connectionState: ReturnType<typeof toEmployeePayoutConnectionState>;
  stripeConfigured: boolean;
  hasAccount: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  canOpenDashboard: boolean;
  updatedAt: string | null;
  heldPlatformCents: number;
  destinationSettledCents: number;
  transferredCents: number;
  refundedCents: number;
  disputedOpenCents: number;
  disputedLostCents: number;
  /** Authoritative Business setting. Never client-supplied. */
  employeeTipPayoutMode: EmployeeTipPayoutMode;
};

type CreateV2AccountFn = (
  params: Record<string, unknown>,
  options?: Stripe.RequestOptions,
) => Promise<unknown>;
type CreateLoginLinkFn = (accountId: string) => Promise<{ url: string }>;

let createV2AccountFn: CreateV2AccountFn | null = null;
let createLoginLinkFn: CreateLoginLinkFn | null = null;

export function __setEmployeeCreateV2AccountFnForTests(fn: CreateV2AccountFn | null): void {
  createV2AccountFn = fn;
}

export function __setEmployeeCreateLoginLinkFnForTests(fn: CreateLoginLinkFn | null): void {
  createLoginLinkFn = fn;
}

export function deriveEmployeeRecipientConnectStatus(input: {
  hasAccount: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  currentlyDueCount: number;
  pastDueCount: number;
  disabledReason: string | null;
}): StripeConnectStatus {
  if (!input.hasAccount) return StripeConnectStatus.not_connected;
  if (input.payoutsEnabled) return StripeConnectStatus.ready;
  if (input.disabledReason || input.pastDueCount > 0) {
    return StripeConnectStatus.restricted;
  }
  if (input.currentlyDueCount > 0) {
    return input.detailsSubmitted
      ? StripeConnectStatus.requires_information
      : StripeConnectStatus.onboarding_incomplete;
  }
  if (!input.detailsSubmitted) return StripeConnectStatus.onboarding_required;
  return StripeConnectStatus.onboarding_incomplete;
}

export function buildEmployeeRecipientAccountsV2CreateParams(input: {
  country: string;
  contactEmail: string;
  displayName: string;
  employeeId: string;
  businessId: string;
}): Record<string, unknown> {
  const country = input.country.trim().toLowerCase();
  const email = input.contactEmail.trim();
  return {
    dashboard: "express",
    ...(email ? { contact_email: email } : {}),
    display_name: input.displayName.trim().slice(0, 100) || "CareTip employee",
    identity: { country: country || "de" },
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { requested: true },
          },
        },
      },
    },
    metadata: {
      caretip_employee_id: input.employeeId,
      caretip_business_id: input.businessId,
    },
    include: ["configuration.recipient", "identity", "defaults"],
  };
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

function employeeConnectStatusDataFromSnap(
  snap: ReturnType<typeof snapshotFromStripeAccount>,
  acceptedAt: Date,
  stripeAccountId?: string,
) {
  const status = deriveEmployeeRecipientConnectStatus({
    hasAccount: true,
    payoutsEnabled: snap.payoutsEnabled,
    detailsSubmitted: snap.detailsSubmitted,
    currentlyDueCount: snap.currentlyDueCount,
    pastDueCount: snap.pastDueCount,
    disabledReason: snap.disabledReason,
  });
  return {
    ...(stripeAccountId ? { stripeAccountId } : {}),
    stripeConnectStatus:
      status === StripeConnectStatus.not_connected
        ? StripeConnectStatus.onboarding_required
        : status,
    stripePayoutsEnabled: snap.payoutsEnabled,
    stripeDetailsSubmitted: snap.detailsSubmitted,
    stripeConnectRequirementsDue: snap.currentlyDueCount,
    stripeConnectDisabledReason: snap.disabledReason,
    stripeConnectUpdatedAt: acceptedAt,
  };
}

function toEmployeeConnectDto(row: {
  stripeAccountId: string | null;
  stripeConnectStatus: StripeConnectStatus;
  stripePayoutsEnabled: boolean;
  stripeDetailsSubmitted: boolean;
  stripeConnectUpdatedAt: Date | null;
} | null): EmployeeConnectStatusDto {
  const hasAccount = Boolean(row?.stripeAccountId?.trim());
  return {
    connectionState: toEmployeePayoutConnectionState(
      hasAccount ? row?.stripeConnectStatus : StripeConnectStatus.not_connected,
      hasAccount,
    ),
    stripeConfigured: isStripeConfigured(),
    hasAccount,
    detailsSubmitted: row?.stripeDetailsSubmitted === true,
    payoutsEnabled: row?.stripePayoutsEnabled === true,
    canOpenDashboard: hasAccount,
    updatedAt: row?.stripeConnectUpdatedAt?.toISOString() ?? null,
    heldPlatformCents: 0,
    destinationSettledCents: 0,
    transferredCents: 0,
    refundedCents: 0,
    disputedOpenCents: 0,
    disputedLostCents: 0,
    employeeTipPayoutMode: EmployeeTipPayoutMode.direct_to_employee,
  };
}

export type ResolvedEmployeeConnectActor = {
  userId: string;
  employeeId: string;
  businessId: string;
  email: string;
  displayName: string;
};

export async function resolveActiveEmployeeForConnect(
  userId: string,
): Promise<ResolvedEmployeeConnectActor> {
  const trimmed = userId.trim();
  if (!trimmed) {
    throw new StripeConnectError("Authentication required", "AUTH_REQUIRED", 401);
  }

  const employee = await prisma.employee.findFirst({
    where: { userId: trimmed },
    select: {
      id: true,
      name: true,
      isActive: true,
      isDeleted: true,
      activationStatus: true,
      businessId: true,
      user: {
        select: {
          email: true,
          isActive: true,
          legalHold: true,
          emailVerified: true,
        },
      },
      business: { select: { deletedAt: true, legalHold: true } },
    },
  });

  if (!employee || employee.isDeleted) {
    throw new StripeConnectError("Employee profile not found", "EMPLOYEE_NOT_FOUND", 404);
  }
  if (!employee.user?.isActive || employee.user.legalHold) {
    throw new StripeConnectError(
      "This account cannot manage a payout connection right now.",
      "EMPLOYEE_CONNECT_BLOCKED",
      403,
    );
  }
  if (employee.business.deletedAt || employee.business.legalHold) {
    throw new StripeConnectError(
      "This account cannot manage a payout connection right now.",
      "EMPLOYEE_CONNECT_BLOCKED",
      403,
    );
  }
  if (!employee.isActive || employee.activationStatus !== "active") {
    throw new StripeConnectError(
      "Finish activating your staff profile before connecting a payout account.",
      "EMPLOYEE_NOT_ACTIVE",
      403,
    );
  }
  if (!employee.user.emailVerified) {
    throw new StripeConnectError(
      "Verify your email before connecting a payout account.",
      "EMPLOYEE_EMAIL_UNVERIFIED",
      403,
    );
  }
  if (!employee.user.email?.trim()) {
    throw new StripeConnectError("Employee profile not found", "EMPLOYEE_NOT_FOUND", 404);
  }

  return {
    userId: trimmed,
    employeeId: employee.id,
    businessId: employee.businessId,
    email: employee.user.email.trim(),
    displayName: employee.name,
  };
}

export async function getEmployeeConnectStatusForUser(
  userId: string,
): Promise<EmployeeConnectStatusDto> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const row = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
  });
  const dto = toEmployeeConnectDto(row);
  const summary = await employeePayableSummaryForEmployee(actor.employeeId);
  const business = await prisma.business.findUnique({
    where: { id: actor.businessId },
    select: { employeeTipPayoutMode: true },
  });
  return {
    ...dto,
    ...summary,
    employeeTipPayoutMode:
      business?.employeeTipPayoutMode ?? EmployeeTipPayoutMode.direct_to_employee,
  };
}

export async function refreshEmployeeConnectStatusFromStripe(userId: string): Promise<void> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const row = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
    select: { stripeAccountId: true },
  });
  const accountId = row?.stripeAccountId?.trim();
  if (!accountId || !isStripeConnectedAccountId(accountId)) return;

  const snap = await retrieveConnectCapabilitySnapshot(accountId);
  if (!snap) return;

  await prisma.employeeStripeAccount.updateMany({
    where: { employeeId: actor.employeeId, stripeAccountId: accountId },
    data: employeeConnectStatusDataFromSnap(snap, new Date()),
  });
}

async function createEmployeeRecipientAccount(input: {
  employeeId: string;
  businessId: string;
  email: string;
  displayName: string;
}): Promise<string> {
  const params = buildEmployeeRecipientAccountsV2CreateParams({
    country: connectDefaultCountry(),
    contactEmail: input.email,
    displayName: input.displayName,
    employeeId: input.employeeId,
    businessId: input.businessId,
  });
  const options = accountsV2RequestOptions(params, {
    idempotencyKey: `connect_express_employee:${input.employeeId}`,
  });

  let payload: unknown;
  if (createV2AccountFn) {
    payload = await createV2AccountFn(params, options);
  } else if (isStripeConfigured()) {
    payload = await getStripeClient().rawRequest(
      "POST",
      STRIPE_ACCOUNTS_V2_CREATE_PATH,
      params,
      options,
    );
  } else {
    throw new StripeConnectError(
      "Payment processing is not configured yet.",
      "STRIPE_NOT_CONFIGURED",
      503,
    );
  }
  return parseV2CreatedAccountId(payload);
}

export async function ensureEmployeeStripeAccount(
  actor: ResolvedEmployeeConnectActor,
): Promise<{ accountId: string; created: boolean }> {
  if (!isStripeConfigured() && !createV2AccountFn) {
    throw new StripeConnectError(
      "Payment processing is not configured yet.",
      "STRIPE_NOT_CONFIGURED",
      503,
    );
  }

  const run = async (): Promise<{ accountId: string; created: boolean }> => {
    const existing = await prisma.employeeStripeAccount.findUnique({
      where: { employeeId: actor.employeeId },
      select: { stripeAccountId: true },
    });
    const stored = existing?.stripeAccountId?.trim();
    if (stored) {
      if (!isStripeConnectedAccountId(stored)) {
        throw new StripeConnectError(
          CONNECT_USER_CREATE_FAILED,
          "STRIPE_ACCOUNT_RETRIEVE_FAILED",
          502,
        );
      }
      return { accountId: stored, created: false };
    }

    const accountId = await createEmployeeRecipientAccount({
      employeeId: actor.employeeId,
      businessId: actor.businessId,
      email: actor.email,
      displayName: actor.displayName,
    });

    const businessCollision = await prisma.business.findFirst({
      where: { stripeAccountId: accountId },
      select: { id: true },
    });
    if (businessCollision) {
      throw new StripeConnectError(
        CONNECT_USER_CREATE_FAILED,
        "STRIPE_ACCOUNT_TENANT_CONFLICT",
        409,
      );
    }

    try {
      await prisma.employeeStripeAccount.create({
        data: {
          employeeId: actor.employeeId,
          stripeAccountId: accountId,
          stripeConnectStatus: StripeConnectStatus.onboarding_required,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const again = await prisma.employeeStripeAccount.findUnique({
          where: { employeeId: actor.employeeId },
          select: { stripeAccountId: true },
        });
        const won = again?.stripeAccountId?.trim();
        if (won) return { accountId: won, created: false };
        throw new StripeConnectError(
          CONNECT_USER_CREATE_FAILED,
          "STRIPE_ACCOUNT_TENANT_CONFLICT",
          409,
        );
      }
      throw err;
    }

    return { accountId, created: true };
  };

  return runSerializedByKey(`employee_stripe_connect_ensure:${actor.employeeId}`, run);
}

export async function createEmployeeConnectAccountLink(userId: string): Promise<{ url: string }> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const { accountId, created } = await ensureEmployeeStripeAccount(actor);

  const base = frontendBaseUrl();
  const refreshUrl = `${base}/employee/payouts?payoutConnect=refresh`;
  const returnUrl = `${base}/employee/payouts?payoutConnect=return`;

  const url = await createConnectOnboardingLinkUrl({
    accountId,
    ownerId: actor.employeeId,
    refreshUrl,
    returnUrl,
  });

  await writeAuditLog({
    userId: actor.userId,
    action: created
      ? "employee_stripe_connect.account_created"
      : "employee_stripe_connect.account_link_created",
    metadata: JSON.stringify({
      employeeId: actor.employeeId,
      accountSuffix: accountId.slice(-8),
    }),
  });

  return { url };
}

export async function createEmployeeConnectLoginLink(userId: string): Promise<{ url: string }> {
  const actor = await resolveActiveEmployeeForConnect(userId);
  const row = await prisma.employeeStripeAccount.findUnique({
    where: { employeeId: actor.employeeId },
    select: { stripeAccountId: true },
  });
  const accountId = row?.stripeAccountId?.trim() ?? "";
  if (!accountId || !isStripeConnectedAccountId(accountId)) {
    throw new StripeConnectError(
      "Connect your payout account before opening the Stripe Dashboard.",
      "STRIPE_CONNECT_NO_ACCOUNT",
      400,
    );
  }

  if (!isStripeConfigured() && !createLoginLinkFn) {
    throw new StripeConnectError(
      "Payment processing is not configured yet.",
      "STRIPE_NOT_CONFIGURED",
      503,
    );
  }

  try {
    const link = createLoginLinkFn
      ? await createLoginLinkFn(accountId)
      : await getStripeClient().accounts.createLoginLink(accountId);
    const url = typeof link?.url === "string" ? link.url.trim() : "";
    if (!url.startsWith("https://")) {
      throw new StripeConnectError(
        CONNECT_USER_LOGIN_LINK_FAILED,
        "STRIPE_LOGIN_LINK_EMPTY",
        502,
      );
    }
    await writeAuditLog({
      userId: actor.userId,
      action: "employee_stripe_connect.login_link_created",
      metadata: JSON.stringify({
        employeeId: actor.employeeId,
        accountSuffix: accountId.slice(-8),
      }),
    });
    return { url };
  } catch (err) {
    if (err instanceof StripeConnectError) throw err;
    logServerError("employeeStripeConnect.accounts.createLoginLink", err, {
      employeeId: actor.employeeId,
      accountSuffix: accountId.slice(-8),
    });
    throw new StripeConnectError(
      CONNECT_USER_LOGIN_LINK_FAILED,
      "STRIPE_LOGIN_LINK_FAILED",
      502,
    );
  }
}

export async function handleEmployeeConnectAccountUpdated(
  account: Stripe.Account,
  opts?: { eventCreatedUnix?: number },
): Promise<{ matched: boolean; employeeId: string | null; skippedStale?: boolean }> {
  const accountId = account.id?.trim();
  if (!accountId) {
    return { matched: false, employeeId: null };
  }

  const row = await prisma.employeeStripeAccount.findUnique({
    where: { stripeAccountId: accountId },
    select: {
      id: true,
      employeeId: true,
      stripeConnectUpdatedAt: true,
    },
  });
  if (!row) {
    return { matched: false, employeeId: null };
  }

  const eventCreatedUnix =
    opts?.eventCreatedUnix ??
    (typeof account.created === "number" && account.created > 0 ? account.created : undefined);

  if (
    eventCreatedUnix != null &&
    !shouldAcceptConnectAccountEvent({
      eventCreatedUnix,
      lastAcceptedAt: row.stripeConnectUpdatedAt,
    })
  ) {
    return { matched: true, employeeId: row.employeeId, skippedStale: true };
  }

  let snap = snapshotFromStripeAccount(account);
  if (
    deriveEmployeeRecipientConnectStatus({
      hasAccount: true,
      payoutsEnabled: snap.payoutsEnabled,
      detailsSubmitted: snap.detailsSubmitted,
      currentlyDueCount: snap.currentlyDueCount,
      pastDueCount: snap.pastDueCount,
      disabledReason: snap.disabledReason,
    }) !== StripeConnectStatus.ready
  ) {
    try {
      const live = await retrieveConnectCapabilitySnapshot(accountId);
      if (live?.payoutsEnabled) snap = live;
    } catch (err) {
      logServerError("employeeStripeConnect.account.updated.live_upgrade", err, {
        employeeId: row.employeeId,
        accountSuffix: accountId.slice(-8),
      });
    }
  }

  const acceptedAt =
    eventCreatedUnix != null && eventCreatedUnix > 0
      ? new Date(eventCreatedUnix * 1000)
      : new Date();

  const updated = await prisma.employeeStripeAccount.updateMany({
    where: {
      id: row.id,
      stripeAccountId: accountId,
      OR: [
        { stripeConnectUpdatedAt: null },
        { stripeConnectUpdatedAt: { lte: acceptedAt } },
      ],
    },
    data: employeeConnectStatusDataFromSnap(snap, acceptedAt),
  });

  if (updated.count === 0) {
    return { matched: true, employeeId: row.employeeId, skippedStale: true };
  }

  const nextStatus = employeeConnectStatusDataFromSnap(snap, acceptedAt).stripeConnectStatus;
  if (nextStatus === StripeConnectStatus.ready && snap.payoutsEnabled) {
    void import("./employeeTipRelease.service.js")
      .then(({ releaseHeldPlatformPayablesForEmployee }) =>
        releaseHeldPlatformPayablesForEmployee(row.employeeId),
      )
      .catch((err) => {
        logServerError("employeeStripeConnect.releaseAfterReady", err, {
          employeeId: row.employeeId,
        });
      });
  }

  return { matched: true, employeeId: row.employeeId, skippedStale: false };
}
