import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2 } from "lucide-react";
import { Link } from "react-router";
import type { BillingStatus } from "../../../../lib/api";
import { BillingStatusBadge } from "./BillingStatusBadge";
import { formatBillingDate, resolveBillingLocale } from "./billingFormatters";
import {
  hasOperationalBillingPlan,
  isOnInternalBasicPlan,
  resolveBillingPlanKey,
} from "../../../../lib/billingDisplayState";
import {
  resolveBillingTrialPlanKey,
  subscriptionPlanDisplayName,
  subscriptionTrialStatusLabel,
} from "../../../../lib/subscriptionPlanDisplayName";
import {
  BILLING_PLANS_SECTION_ID,
  scrollToBillingPlansSection,
} from "../../../../lib/activateCareTipNavigation";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";
import { cn } from "@/lib/utils";

function sponsoredProgrammeLabel(
  billing: BillingStatus,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (billing.sponsoredProgrammeLabelKey) {
    return t(billing.sponsoredProgrammeLabelKey);
  }
  if (billing.sponsoredProgrammeKey) {
    return t(`sponsored.programmes.${billing.sponsoredProgrammeKey}`, {
      defaultValue: billing.sponsoredProgrammeKey,
    });
  }
  return t("sponsored.programmes.generic");
}

type Props = {
  billing: BillingStatus;
  onManageBilling?: () => void;
  manageBillingBusy?: boolean;
  className?: string;
};

export function BillingSubscriptionSummary({
  billing,
  onManageBilling,
  manageBillingBusy = false,
  className,
}: Props) {
  const { t, i18n } = useTranslation();
  const locale = resolveBillingLocale(i18n.language);
  const emptyDate = t("business.billing.notApplicable");

  if (billing.accessSource === "sponsored") {
    const programme = sponsoredProgrammeLabel(billing, t);
    return (
      <section
        className={cn("billing-subscription-summary billing-subscription-summary--sponsored", className)}
        aria-labelledby="billing-summary-heading"
      >
        <h2 id="billing-summary-heading" className="billing-subscription-summary__plan">
          {programme}
        </h2>
        <p className="billing-subscription-summary__inline-meta">
          {t("business.billing.subscriptionSummary.sponsoredProgramme")}
        </p>
        <div className="billing-subscription-summary__actions">
          <Link
            to="/contact?intent=support"
            className={cn(dashboardWorkspaceUi.btnSecondary, "inline-flex")}
          >
            {t("business.billing.subscriptionSummary.contactSupport")}
          </Link>
        </div>
      </section>
    );
  }

  if (!hasOperationalBillingPlan(billing)) {
    return (
      <section
        className={cn("billing-subscription-summary billing-subscription-summary--empty", className)}
        aria-labelledby="billing-summary-heading"
      >
        <div className="billing-subscription-summary__header">
          <div className="min-w-0">
            <p className="billing-subscription-summary__eyebrow">
              {t("business.billing.subscriptionSummary.currentPlanLabel")}
            </p>
            <h2 id="billing-summary-heading" className="billing-subscription-summary__plan">
              {t("business.billing.subscriptionSummary.noActiveTitle")}
            </h2>
          </div>
          <a
            href={`#${BILLING_PLANS_SECTION_ID}`}
            onClick={(e) => {
              e.preventDefault();
              scrollToBillingPlansSection("smooth");
            }}
            className={cn(dashboardWorkspaceUi.btnSecondary, "inline-flex shrink-0")}
          >
            {t("business.billing.managePlan")}
          </a>
        </div>
        <p className="billing-subscription-summary__inline-meta">
          {t("business.billing.subscriptionSummary.noActiveBody")}
        </p>
      </section>
    );
  }

  const planKey = resolveBillingPlanKey(billing) ?? "basic";
  const effectivePlanKey = resolveBillingTrialPlanKey(billing) ?? planKey;
  const planName = subscriptionPlanDisplayName(effectivePlanKey, t);
  const isTrialing =
    billing.isTrial || billing.status === "trialing" || billing.trialDaysRemaining != null;
  const trialDays = billing.trialDaysRemaining ?? 0;
  const renewalDate = billing.renewalDate ?? billing.currentPeriodEnd;
  const onBasic = isOnInternalBasicPlan(billing);

  const detailRows: Array<{ label: string; value: ReactNode }> = [];

  if (!onBasic && renewalDate) {
    detailRows.push({
      label: t("business.billing.subscriptionSummary.nextRenewal"),
      value: formatBillingDate(renewalDate, locale, emptyDate),
    });
  }

  if (billing.hasStripeBilling) {
    detailRows.push({
      label: t("business.billing.subscriptionSummary.paymentMethod"),
      value: t("business.billing.subscriptionSummary.paymentMethodManaged"),
    });
  }

  const showManageBilling = Boolean(onManageBilling && billing.hasStripeBilling);
  const badgeStatus = onBasic
    ? ("active" as const)
    : billing.status !== "none"
      ? billing.status
      : null;

  return (
    <section
      className={cn("billing-subscription-summary", className)}
      aria-labelledby="billing-summary-heading"
    >
      <div className="billing-subscription-summary__header">
        <div className="min-w-0">
          <p className="billing-subscription-summary__eyebrow">
            {t("business.billing.subscriptionSummary.currentPlanLabel")}
          </p>
          <h2 id="billing-summary-heading" className="billing-subscription-summary__plan">
            {isTrialing ? subscriptionTrialStatusLabel(effectivePlanKey, t) : planName}
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <a
            href={`#${BILLING_PLANS_SECTION_ID}`}
            onClick={(e) => {
              e.preventDefault();
              scrollToBillingPlansSection("smooth");
            }}
            className={cn(dashboardWorkspaceUi.btnPrimary, "inline-flex")}
          >
            {t("business.billing.managePlan")}
          </a>
          {showManageBilling ? (
            <button
              type="button"
              onClick={onManageBilling}
              disabled={manageBillingBusy}
              className={cn(
                dashboardWorkspaceUi.btnSecondary,
                "inline-flex gap-2 disabled:opacity-60",
              )}
              aria-busy={manageBillingBusy || undefined}
            >
              {manageBillingBusy ? (
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
              ) : (
                <CreditCard className="size-4 shrink-0" aria-hidden />
              )}
              {t("business.billing.manageBilling")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="billing-subscription-summary__status-row mt-3 flex flex-wrap items-center gap-2">
        {badgeStatus ? <BillingStatusBadge status={badgeStatus} /> : null}
        {isTrialing && trialDays > 0 ? (
          <span className="text-sm text-muted-foreground">
            {t("business.billing.trial.daysRemaining", { count: trialDays })}
          </span>
        ) : null}
        {onBasic ? (
          <span className="text-sm text-muted-foreground">
            {t("business.billing.subscriptionSummary.basicPrice")}
          </span>
        ) : null}
      </div>

      {detailRows.length > 0 ? (
        <dl className="billing-subscription-summary__details mt-4 space-y-2">
          {detailRows.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
            >
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
