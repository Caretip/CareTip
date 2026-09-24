/**
 * Business financial summary — CareTip ledger + read-only Stripe connected-account data.
 */
import { EmployeeTipPayoutMode } from "@prisma/client";
import { prisma } from "../prisma.js";
import type { BusinessTimeframe } from "../utils/businessTime.js";
import { sanitizeIanaTimezone } from "../utils/businessTime.js";
import { logDashboardPhase } from "../utils/dashboardTiming.js";
import {
  loadBusinessFinancialMetrics,
  type BusinessFinancialMetrics,
} from "./businessFinancialMetrics.service.js";
import { reconcileBusinessPayables } from "./businessPayoutReconciliation.service.js";
import { summarizePayoutsForBusiness } from "./stripeConnectPayout.service.js";
import { getStripeClient, isStripeConfigured } from "./stripe.service.js";
import { businessDistributionObservabilityForBusiness } from "./businessDistributionIntegrity.service.js";
import { employeeTipHoldObservabilityForBusiness } from "./employeeTipPayable.service.js";

export type BusinessFinancialSummarySection = "ledger" | "connect" | "reconciliation";

export type BusinessFinancialSummaryBundle = {
  period: BusinessTimeframe;
  periodBasis: string;
  lifetime: BusinessFinancialMetrics;
  periodMetrics: BusinessFinancialMetrics;
  routing: {
    mode: EmployeeTipPayoutMode;
    heldPlatformCents: number;
    heldPlatformRowCount: number;
    heldBusinessCents: number;
    heldBusinessRowCount: number;
  };
  stripe: {
    readable: boolean;
    connected: boolean;
    availableCents: number | null;
    pendingCents: number | null;
    currency: string | null;
  };
  payouts: {
    completedAmountCents: number;
    pendingAmountCents: number;
    currency: string;
    mixedCurrency: boolean;
  };
  reconciliation?: Awaited<ReturnType<typeof reconcileBusinessPayables>>;
};

const EMPTY_PAYOUT_SUMMARY = {
  currency: "eur",
  mixedCurrency: false,
  completedAmountCents: 0,
  pendingAmountCents: 0,
  totalCount: 0,
  pendingCount: 0,
  inTransitCount: 0,
  completedCount: 0,
  failedCount: 0,
  failedAmountCents: 0,
  canceledCount: 0,
  totalAmountSentCents: 0,
};

const EMPTY_LEDGER_METRICS: BusinessFinancialMetrics = {
  totalCustomerTipsEur: 0,
  tipCount: 0,
  employeeDistributionObligationEur: 0,
  employeeDistributionObligationRowCount: 0,
  directToEmployeeGrossTipsEur: 0,
  businessDistributionGrossTipsEur: 0,
  caretipFeesEur: null,
  feesExact: false,
};

type StripeBalanceSnapshot = {
  stripeReadable: boolean;
  availableCents: number | null;
  pendingCents: number | null;
  currency: string | null;
};

async function retrieveStripeBalanceForAccount(
  stripeAccountId: string,
  connected: boolean,
): Promise<StripeBalanceSnapshot> {
  const empty: StripeBalanceSnapshot = {
    stripeReadable: false,
    availableCents: null,
    pendingCents: null,
    currency: null,
  };
  if (!connected || !isStripeConfigured()) return empty;
  try {
    const bal = await logDashboardPhase("business.financialSummary", "stripeBalance", () =>
      getStripeClient().balance.retrieve({ stripeAccount: stripeAccountId }),
    );
    return {
      stripeReadable: true,
      availableCents: bal.available[0]?.amount ?? 0,
      pendingCents: bal.pending[0]?.amount ?? 0,
      currency: bal.available[0]?.currency ?? "eur",
    };
  } catch {
    return empty;
  }
}

export async function loadBusinessFinancialSummaryForBusiness(
  businessId: string,
  opts?: {
    period?: BusinessTimeframe;
    businessTimezone?: string;
    /** When set, return only ledger or connect slices for progressive hero hydration. */
    section?: BusinessFinancialSummarySection;
    /** Reconciliation is deferred from the hero path; opt in for analytics surfaces. */
    includeReconciliation?: boolean;
  },
): Promise<BusinessFinancialSummaryBundle> {
  const period = opts?.period ?? "all";
  const tz = sanitizeIanaTimezone(opts?.businessTimezone ?? "Europe/Berlin");
  const section = opts?.section;
  const wantLedger = section == null || section === "ledger";
  const wantConnect = section == null || section === "connect";
  const wantReconciliation =
    section === "reconciliation" || (Boolean(opts?.includeReconciliation) && section == null);

  const business = await logDashboardPhase("business.financialSummary", "businessLookup", () =>
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        stripeAccountId: true,
        stripeConnectStatus: true,
        employeeTipPayoutMode: true,
        timezone: true,
      },
    }),
  );
  const businessTimezone = business?.timezone?.trim() || tz;
  const stripeAccountId = business?.stripeAccountId?.trim() ?? "";
  const connected =
    Boolean(stripeAccountId.startsWith("acct_")) && business?.stripeConnectStatus === "ready";
  const payoutMode = business?.employeeTipPayoutMode ?? EmployeeTipPayoutMode.direct_to_employee;

  const stripeBalancePromise = wantConnect
    ? retrieveStripeBalanceForAccount(stripeAccountId, connected)
    : null;

  const ledgerSlicePromise = wantLedger
    ? logDashboardPhase("business.financialSummary", "ledgerBundle", async () => {
        const distribution = await businessDistributionObservabilityForBusiness(businessId);
        const lifetimePromise = loadBusinessFinancialMetrics(businessId, {
          period: "all",
          businessTimezone,
          distributionObservability: distribution,
        });
        const periodMetricsPromise =
          period === "all"
            ? lifetimePromise
            : loadBusinessFinancialMetrics(businessId, {
                period,
                businessTimezone,
                distributionObservability: distribution,
              });
        const [lifetime, periodMetrics, holds] = await Promise.all([
          lifetimePromise,
          periodMetricsPromise,
          employeeTipHoldObservabilityForBusiness(businessId),
        ]);
        return {
          lifetime,
          periodMetrics,
          routing: {
            mode: payoutMode,
            heldPlatformCents: holds.heldPlatformCents,
            heldPlatformRowCount: holds.heldRowCount,
            heldBusinessCents: distribution.heldBusinessCents,
            heldBusinessRowCount: distribution.heldBusinessRowCount,
          },
        };
      })
    : Promise.resolve(null);

  const connectSlicePromise = wantConnect
    ? logDashboardPhase("business.financialSummary", "connectBundle", async () => {
        const [payoutSummary, stripeBalance] = await Promise.all([
          summarizePayoutsForBusiness(businessId).catch(() => EMPTY_PAYOUT_SUMMARY),
          stripeBalancePromise!,
        ]);
        return {
          stripe: {
            readable: stripeBalance.stripeReadable,
            connected,
            availableCents: stripeBalance.availableCents,
            pendingCents: stripeBalance.pendingCents,
            currency: stripeBalance.currency,
          },
          payouts: {
            completedAmountCents: payoutSummary.completedAmountCents,
            pendingAmountCents: payoutSummary.pendingAmountCents,
            currency: payoutSummary.currency,
            mixedCurrency: payoutSummary.mixedCurrency,
          },
        };
      })
    : Promise.resolve(null);

  const reconciliationPromise = wantReconciliation
    ? logDashboardPhase("business.financialSummary", "reconciliation", () =>
        reconcileBusinessPayables(businessId),
      )
    : Promise.resolve(undefined);

  const [ledgerSlice, connectSlice, reconciliation] = await Promise.all([
    ledgerSlicePromise,
    connectSlicePromise,
    reconciliationPromise,
  ]);

  const bundle: BusinessFinancialSummaryBundle = {
    period,
    periodBasis: "tip_created_at",
    lifetime: ledgerSlice?.lifetime ?? EMPTY_LEDGER_METRICS,
    periodMetrics: ledgerSlice?.periodMetrics ?? EMPTY_LEDGER_METRICS,
    routing: ledgerSlice?.routing ?? {
      mode: payoutMode,
      heldPlatformCents: 0,
      heldPlatformRowCount: 0,
      heldBusinessCents: 0,
      heldBusinessRowCount: 0,
    },
    stripe: connectSlice?.stripe ?? {
      readable: false,
      connected,
      availableCents: null,
      pendingCents: null,
      currency: null,
    },
    payouts: connectSlice?.payouts ?? {
      completedAmountCents: 0,
      pendingAmountCents: 0,
      currency: "eur",
      mixedCurrency: false,
    },
  };

  if (reconciliation) {
    bundle.reconciliation = reconciliation;
  }

  return bundle;
}
