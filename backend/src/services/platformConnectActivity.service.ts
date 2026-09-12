/**
 * Admin Connect activity: business bank/instant payouts, employee bank/instant payouts,
 * and CareTip → employee Stripe transfers. Not a second ledger — reads existing tables.
 */
import {
  EmployeeTipChargeModel,
  EmployeeTipPayableStatus,
  Prisma,
  StripeConnectPayoutReconciliationStatus,
  StripeConnectPayoutStatus,
} from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  getPlatformConnectPayout,
  listPlatformConnectPayouts,
  mapStripePayoutStatus,
  payoutCentsToEur,
  type PlatformConnectPayoutDto,
} from "./stripeConnectPayout.service.js";

export type ConnectRecipientKind = "business" | "employee";
export type ConnectActivityKind = "business_payout" | "employee_payout" | "caretip_transfer";
export type ConnectMovementKind = "bank_payout" | "instant_payout" | "caretip_transfer";

export type PlatformConnectActivityDto = Omit<PlatformConnectPayoutDto, "reconciliationStatus"> & {
  reconciliationStatus: StripeConnectPayoutReconciliationStatus | "stripe_observed" | "ledger";
  recipientKind: ConnectRecipientKind;
  activityKind: ConnectActivityKind;
  movementKind: ConnectMovementKind;
  employeeId: string | null;
  employeeName: string | null;
  recipientName: string;
  source: "stripe" | "caretip";
  stripeObjectId: string | null;
  stripeObjectKind: "payout" | "transfer" | null;
  routingMode: string | null;
  chargeModel: string | null;
  payableStatus: string | null;
  reversedCents: number | null;
  refundedCents: number | null;
  grossCents: number | null;
  transferredCents: number | null;
  canRetryReconciliation: boolean;
};

type EmployeePayoutListRow = Prisma.EmployeeStripePayoutGetPayload<{
  include: { employee: { select: { name: true } }; business: { select: { name: true } } };
}>;
type CareTipTransferListRow = Prisma.EmployeeTipPayableGetPayload<{
  include: { employee: { select: { name: true } }; business: { select: { name: true } } };
}>;

const EMPLOYEE_PAYOUT_PREFIX = "ep_";
const CARETIP_TRANSFER_PREFIX = "ct_";

function accountSuffix(accountId: string | null | undefined): string {
  const id = accountId?.trim() ?? "";
  if (id.length < 4) return "";
  return id.length <= 8 ? id : id.slice(-8);
}

function stripeDashboardUrls(accountId: string, payoutId: string): {
  stripeDashboardAccountUrl: string;
  stripeDashboardPayoutUrl: string;
} {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const test = secret.startsWith("sk_test_");
  const base = test ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  return {
    stripeDashboardAccountUrl: `${base}/connect/accounts/${accountId}`,
    stripeDashboardPayoutUrl: `${base}/connect/accounts/${accountId}/payouts/${payoutId}`,
  };
}

function platformTransferUrl(transferId: string): string {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const test = secret.startsWith("sk_test_");
  const base = test ? "https://dashboard.stripe.com/test" : "https://dashboard.stripe.com";
  return `${base}/transfers/${transferId}`;
}

function movementFromMethod(method: string | null | undefined): ConnectMovementKind {
  return String(method ?? "").toLowerCase() === "instant" ? "instant_payout" : "bank_payout";
}

function withBusinessActivity(row: PlatformConnectPayoutDto, stripeObjectId: string | null): PlatformConnectActivityDto {
  return {
    ...row,
    recipientKind: "business",
    activityKind: "business_payout",
    movementKind: movementFromMethod(row.method),
    employeeId: null,
    employeeName: null,
    recipientName: row.businessName,
    source: "stripe",
    stripeObjectId,
    stripeObjectKind: stripeObjectId?.startsWith("po_") ? "payout" : null,
    routingMode: null,
    chargeModel: null,
    payableStatus: null,
    reversedCents: null,
    refundedCents: null,
    grossCents: null,
    transferredCents: null,
    canRetryReconciliation: true,
  };
}

function methodWhere(methodRaw: string | undefined): Prisma.EmployeeStripePayoutWhereInput | null {
  const method = methodRaw?.trim().toLowerCase();
  if (method === "instant" || method === "standard") return { method };
  if (method === "unknown") return { OR: [{ method: null }, { method: "" }] };
  return null;
}

function dateRangeWhere(
  from: string | undefined,
  to: string | undefined,
): Prisma.DateTimeFilter | null {
  const gte = from?.trim() ? new Date(from) : null;
  const lte = to?.trim() ? new Date(to) : null;
  const filter: Prisma.DateTimeFilter = {};
  if (gte && !Number.isNaN(gte.getTime())) filter.gte = gte;
  if (lte && !Number.isNaN(lte.getTime())) filter.lte = lte;
  return Object.keys(filter).length ? filter : null;
}

function employeePayoutWhere(opts: {
  businessId?: string;
  status?: string;
  currency?: string;
  method?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  movement?: string;
}): Prisma.EmployeeStripePayoutWhereInput {
  const and: Prisma.EmployeeStripePayoutWhereInput[] = [];
  if (opts.businessId?.trim()) and.push({ businessId: opts.businessId.trim() });
  const statusRaw = opts.status?.trim().toLowerCase();
  if (statusRaw && statusRaw !== "all") {
    const mapped = mapStripePayoutStatus(statusRaw);
    if (mapped !== StripeConnectPayoutStatus.unknown || statusRaw === "unknown") {
      and.push({ status: mapped });
    }
  }
  const mw = methodWhere(opts.method);
  if (mw) and.push(mw);
  const movement = opts.movement?.trim().toLowerCase();
  if (movement === "instant_payout") and.push({ method: "instant" });
  if (movement === "bank_payout") {
    and.push({ OR: [{ method: null }, { method: "" }, { method: { not: "instant" } }] });
  }
  const currency = opts.currency?.trim().toLowerCase();
  if (currency) and.push({ currency });
  const created = dateRangeWhere(opts.createdFrom, opts.createdTo);
  if (created) and.push({ stripeCreatedAt: created });
  const q = opts.q?.trim();
  if (q) {
    const idOr: Prisma.EmployeeStripePayoutWhereInput[] = [
      { employee: { name: { contains: q, mode: "insensitive" } } },
      { business: { name: { contains: q, mode: "insensitive" } } },
      { stripePayoutId: { contains: q, mode: "insensitive" } },
      { id: { contains: q, mode: "insensitive" } },
    ];
    if (q.length >= 4) idOr.push({ stripeAccountId: { endsWith: q } });
    and.push({ OR: idOr });
  }
  return and.length ? { AND: and } : {};
}

function transferStatusWhere(statusRaw: string | undefined): Prisma.EmployeeTipPayableWhereInput | null {
  const status = statusRaw?.trim().toLowerCase();
  if (!status || status === "all") return null;
  if (status === "paid") return { status: { in: [EmployeeTipPayableStatus.transferred] } };
  if (status === "pending" || status === "in_transit") {
    return {
      status: {
        in: [
          EmployeeTipPayableStatus.transferring,
          EmployeeTipPayableStatus.held_platform,
          EmployeeTipPayableStatus.held_business,
        ],
      },
    };
  }
  if (status === "failed") return { status: EmployeeTipPayableStatus.transfer_failed };
  if (status === "canceled") return { status: EmployeeTipPayableStatus.refunded };
  return { status: { in: [] } };
}

function transferWhere(opts: {
  businessId?: string;
  status?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
}): Prisma.EmployeeTipPayableWhereInput {
  const and: Prisma.EmployeeTipPayableWhereInput[] = [
    { stripeTransferId: { not: null } },
    { chargeModel: EmployeeTipChargeModel.platform_hold },
    { stripeTransferId: { startsWith: "tr_" } },
  ];
  if (opts.businessId?.trim()) and.push({ businessId: opts.businessId.trim() });
  const st = transferStatusWhere(opts.status);
  if (st) and.push(st);
  const created = dateRangeWhere(opts.createdFrom, opts.createdTo);
  if (created) and.push({ createdAt: created });
  const q = opts.q?.trim();
  if (q) {
    and.push({
      OR: [
        { employee: { name: { contains: q, mode: "insensitive" } } },
        { business: { name: { contains: q, mode: "insensitive" } } },
        { stripeTransferId: { contains: q, mode: "insensitive" } },
        { id: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

function employeePayoutToDto(row: {
  id: string;
  employeeId: string;
  businessId: string;
  stripeAccountId: string;
  stripePayoutId: string;
  amountCents: number;
  currency: string;
  status: StripeConnectPayoutStatus;
  arrivalDate: Date | null;
  method: string | null;
  payoutType: string | null;
  description: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  stripeCreatedAt: Date;
  createdAt: Date;
  paidAt: Date | null;
  failedAt: Date | null;
  canceledAt: Date | null;
  applicationFeeAmountCents: number | null;
  stripeApplicationFeeId: string | null;
  employee: { name: string };
  business: { name: string };
}): PlatformConnectActivityDto {
  const dash = stripeDashboardUrls(row.stripeAccountId, row.stripePayoutId);
  const issue = row.status === StripeConnectPayoutStatus.failed || row.status === StripeConnectPayoutStatus.canceled;
  return {
    id: `${EMPLOYEE_PAYOUT_PREFIX}${row.id}`,
    amountCents: row.amountCents,
    amountEur: payoutCentsToEur(row.amountCents),
    currency: row.currency,
    status: row.status,
    arrivalDate: row.arrivalDate?.toISOString() ?? null,
    method: row.method,
    payoutType: row.payoutType,
    description: row.description,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
    stripeCreatedAt: row.stripeCreatedAt.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    reconciliationStatus: issue ? StripeConnectPayoutReconciliationStatus.failed : "stripe_observed",
    reconciliationLastError: null,
    applicationFeeAmountCents: row.applicationFeeAmountCents,
    stripeApplicationFeeId: row.stripeApplicationFeeId,
    instantRequestAmountCents: null,
    balanceLineCount: 0,
    businessId: row.businessId,
    businessName: row.business.name,
    stripeAccountSuffix: accountSuffix(row.stripeAccountId),
    stripeDashboardAccountUrl: dash.stripeDashboardAccountUrl,
    stripeDashboardPayoutUrl: dash.stripeDashboardPayoutUrl,
    recipientKind: "employee",
    activityKind: "employee_payout",
    movementKind: movementFromMethod(row.method),
    employeeId: row.employeeId,
    employeeName: row.employee.name,
    recipientName: row.employee.name,
    source: "stripe",
    stripeObjectId: row.stripePayoutId,
    stripeObjectKind: "payout",
    routingMode: null,
    chargeModel: null,
    payableStatus: null,
    reversedCents: null,
    refundedCents: null,
    grossCents: null,
    transferredCents: null,
    canRetryReconciliation: false,
  };
}

function payableToDto(row: {
  id: string;
  employeeId: string | null;
  businessId: string;
  routingMode: string;
  chargeModel: string;
  status: EmployeeTipPayableStatus;
  grossCents: number;
  payableCents: number;
  transferredCents: number;
  reversedCents: number;
  refundedCents: number;
  stripeTransferId: string | null;
  stripeDestinationAccountId: string | null;
  lastTransferError: string | null;
  createdAt: Date;
  updatedAt: Date;
  employee: { name: string } | null;
  business: { name: string };
}): PlatformConnectActivityDto {
  const amountCents = row.transferredCents > 0 ? row.transferredCents : row.payableCents;
  const transferId = row.stripeTransferId;
  const reconFailed =
    row.status === EmployeeTipPayableStatus.transfer_failed ||
    row.reversedCents > 0 ||
    Boolean(row.lastTransferError);
  return {
    id: `${CARETIP_TRANSFER_PREFIX}${row.id}`,
    amountCents,
    amountEur: payoutCentsToEur(amountCents),
    currency: "eur",
    status: mapPayableStatus(row.status),
    arrivalDate: null,
    method: null,
    payoutType: "caretip_transfer",
    description: null,
    failureCode: null,
    failureMessage: row.lastTransferError,
    createdAt: row.createdAt.toISOString(),
    stripeCreatedAt: row.createdAt.toISOString(),
    paidAt: row.status === EmployeeTipPayableStatus.transferred ? row.updatedAt.toISOString() : null,
    failedAt: row.status === EmployeeTipPayableStatus.transfer_failed ? row.updatedAt.toISOString() : null,
    canceledAt: row.status === EmployeeTipPayableStatus.refunded ? row.updatedAt.toISOString() : null,
    reconciliationStatus: reconFailed
      ? StripeConnectPayoutReconciliationStatus.failed
      : row.status === EmployeeTipPayableStatus.transferred
        ? "ledger"
        : StripeConnectPayoutReconciliationStatus.pending,
    reconciliationLastError: null,
    applicationFeeAmountCents: null,
    stripeApplicationFeeId: null,
    instantRequestAmountCents: null,
    balanceLineCount: 0,
    businessId: row.businessId,
    businessName: row.business.name,
    stripeAccountSuffix: accountSuffix(row.stripeDestinationAccountId),
    stripeDashboardAccountUrl: row.stripeDestinationAccountId?.startsWith("acct_")
      ? stripeDashboardUrls(row.stripeDestinationAccountId, "payout").stripeDashboardAccountUrl
      : null,
    stripeDashboardPayoutUrl: transferId ? platformTransferUrl(transferId) : null,
    recipientKind: "employee",
    activityKind: "caretip_transfer",
    movementKind: "caretip_transfer",
    employeeId: row.employeeId,
    employeeName: row.employee?.name ?? null,
    recipientName: row.employee?.name ?? row.business.name,
    source: "caretip",
    stripeObjectId: transferId,
    stripeObjectKind: transferId ? "transfer" : null,
    routingMode: row.routingMode,
    chargeModel: row.chargeModel,
    payableStatus: row.status,
    reversedCents: row.reversedCents,
    refundedCents: row.refundedCents,
    grossCents: row.grossCents,
    transferredCents: row.transferredCents,
    canRetryReconciliation: false,
  };
}

function mapPayableStatus(status: EmployeeTipPayableStatus): StripeConnectPayoutStatus {
  if (status === EmployeeTipPayableStatus.transferred) return StripeConnectPayoutStatus.paid;
  if (status === EmployeeTipPayableStatus.transfer_failed) return StripeConnectPayoutStatus.failed;
  if (status === EmployeeTipPayableStatus.refunded) return StripeConnectPayoutStatus.canceled;
  if (status === EmployeeTipPayableStatus.transferring) return StripeConnectPayoutStatus.in_transit;
  return StripeConnectPayoutStatus.pending;
}

function sortKey(row: PlatformConnectActivityDto): number {
  return new Date(row.stripeCreatedAt).getTime();
}

export async function listPlatformConnectActivity(opts?: {
  take?: number;
  skip?: number;
  businessId?: string;
  status?: string;
  reconciliationStatus?: string;
  currency?: string;
  method?: string;
  createdFrom?: string;
  createdTo?: string;
  q?: string;
  recipient?: string;
  movement?: string;
}): Promise<{ items: PlatformConnectActivityDto[]; total: number }> {
  const take = Math.min(Math.max(opts?.take ?? 50, 1), 100);
  const skip = Math.max(opts?.skip ?? 0, 0);
  const window = Math.min(skip + take, 10_100);
  const recipient = opts?.recipient?.trim().toLowerCase() ?? "all";
  const movement = opts?.movement?.trim().toLowerCase() ?? "all";
  const recon = opts?.reconciliationStatus?.trim().toLowerCase();
  const reconActive = Boolean(recon && recon !== "all");
  const methodRaw = opts?.method?.trim().toLowerCase();
  const methodActive = Boolean(methodRaw && methodRaw !== "all");

  const includeBusiness =
    recipient !== "employee" &&
    movement !== "caretip_transfer" &&
    !(movement === "instant_payout" && methodRaw === "standard") &&
    !(movement === "bank_payout" && methodRaw === "instant");
  const includeEmployeePayout =
    recipient !== "business" &&
    movement !== "caretip_transfer" &&
    !reconActive &&
    !(movement === "instant_payout" && methodRaw === "standard") &&
    !(movement === "bank_payout" && methodRaw === "instant");
  const currencyRaw = opts?.currency?.trim().toLowerCase();
  const includeTransfer =
    recipient !== "business" &&
    (movement === "all" || movement === "caretip_transfer") &&
    !reconActive &&
    !methodActive &&
    (!currencyRaw || currencyRaw === "all" || currencyRaw === "eur");

  const businessMethod =
    movement === "instant_payout"
      ? "instant"
      : movement === "bank_payout"
        ? methodRaw && methodRaw !== "all"
          ? methodRaw
          : "not_instant"
        : opts?.method;

  const tasks: Array<Promise<void>> = [];
  let businessItems: PlatformConnectPayoutDto[] = [];
  let businessTotal = 0;
  let employeeRows: EmployeePayoutListRow[] = [];
  let employeeTotal = 0;
  let transferRows: CareTipTransferListRow[] = [];
  let transferTotal = 0;

  if (includeBusiness) {
    tasks.push(
      (async () => {
        const result = await listPlatformConnectPayouts({
          take: window,
          skip: 0,
          businessId: opts?.businessId,
          status: opts?.status,
          reconciliationStatus: opts?.reconciliationStatus,
          currency: opts?.currency,
          method: businessMethod,
          createdFrom: opts?.createdFrom,
          createdTo: opts?.createdTo,
          q: opts?.q,
        });
        businessItems = result.items;
        businessTotal = result.total;
      })(),
    );
  }

  if (includeEmployeePayout) {
    const where = employeePayoutWhere({
      businessId: opts?.businessId,
      status: opts?.status,
      currency: opts?.currency,
      method: movement === "instant_payout" ? "instant" : opts?.method,
      createdFrom: opts?.createdFrom,
      createdTo: opts?.createdTo,
      q: opts?.q,
      movement,
    });
    tasks.push(
      (async () => {
        const [total, rows] = await Promise.all([
          prisma.employeeStripePayout.count({ where }),
          prisma.employeeStripePayout.findMany({
            where,
            orderBy: [{ stripeCreatedAt: "desc" }, { id: "desc" }],
            take: window,
            skip: 0,
            include: {
              employee: { select: { name: true } },
              business: { select: { name: true } },
            },
          }),
        ]);
        employeeTotal = total;
        employeeRows = rows;
      })(),
    );
  }

  if (includeTransfer) {
    const where = transferWhere({
      businessId: opts?.businessId,
      status: opts?.status,
      createdFrom: opts?.createdFrom,
      createdTo: opts?.createdTo,
      q: opts?.q,
    });
    tasks.push(
      (async () => {
        const [total, rows] = await Promise.all([
          prisma.employeeTipPayable.count({ where }),
          prisma.employeeTipPayable.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: window,
            skip: 0,
            include: {
              employee: { select: { name: true } },
              business: { select: { name: true } },
            },
          }),
        ]);
        transferTotal = total;
        transferRows = rows;
      })(),
    );
  }

  await Promise.all(tasks);

  const merged: PlatformConnectActivityDto[] = [
    ...businessItems.map((row) => withBusinessActivity(row, null)),
    ...employeeRows.map(employeePayoutToDto),
    ...transferRows.map(payableToDto),
  ].sort((a, b) => {
    const dt = sortKey(b) - sortKey(a);
    if (dt !== 0) return dt;
    return b.id.localeCompare(a.id);
  });

  return {
    items: merged.slice(skip, skip + take),
    total: businessTotal + employeeTotal + transferTotal,
  };
}

export async function getPlatformConnectActivity(id: string): Promise<PlatformConnectActivityDto | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(EMPLOYEE_PAYOUT_PREFIX)) {
    const rowId = trimmed.slice(EMPLOYEE_PAYOUT_PREFIX.length);
    const row = await prisma.employeeStripePayout.findUnique({
      where: { id: rowId },
      include: {
        employee: { select: { name: true } },
        business: { select: { name: true } },
      },
    });
    return row ? employeePayoutToDto(row) : null;
  }

  if (trimmed.startsWith(CARETIP_TRANSFER_PREFIX)) {
    const rowId = trimmed.slice(CARETIP_TRANSFER_PREFIX.length);
    const row = await prisma.employeeTipPayable.findFirst({
      where: {
        id: rowId,
        stripeTransferId: { not: null },
        chargeModel: EmployeeTipChargeModel.platform_hold,
      },
      include: {
        employee: { select: { name: true } },
        business: { select: { name: true } },
      },
    });
    return row ? payableToDto(row) : null;
  }

  const payout = await getPlatformConnectPayout(trimmed);
  if (!payout) return null;
  const stored = await prisma.stripeConnectPayout.findUnique({
    where: { id: trimmed },
    select: { stripePayoutId: true },
  });
  return withBusinessActivity(payout, stored?.stripePayoutId ?? null);
}
