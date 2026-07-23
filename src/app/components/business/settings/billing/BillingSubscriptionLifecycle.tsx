import { useTranslation } from "react-i18next";
import type { BillingStatus } from "../../../../lib/api";
import { formatBillingDate, resolveBillingLocale } from "./billingFormatters";
import { dashboardWorkspaceUi } from "@/app/components/dashboard/dashboardWorkspaceUi";

function formatDate(iso: string | null, locale: string, emptyLabel: string): string {
  if (!iso) return emptyLabel;
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "Europe/Berlin",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

type Props = {
  billing: BillingStatus;
};

/**
 * Cancellation and lifecycle details only — plan, status, and renewal live in BillingSubscriptionSummary.
 */
export function BillingSubscriptionLifecycle({ billing }: Props) {
  const { t, i18n } = useTranslation();
  const locale = resolveBillingLocale(i18n.language);

  const renewalDate = billing.renewalDate ?? billing.currentPeriodEnd;
  const cancellationEffective = billing.cancelAtPeriodEnd ? billing.cancellationEffective : null;
  const hasCancellationDetails = Boolean(billing.cancelAtPeriodEnd && cancellationEffective);
  const hasTrialConversion = Boolean(billing.trialEndsAt && !billing.cancelAtPeriodEnd);

  if (!hasCancellationDetails && !hasTrialConversion) {
    return null;
  }

  return (
    <section
      className="rounded-lg border border-border bg-muted/20 px-4 py-3"
      aria-labelledby="billing-lifecycle-heading"
    >
      <h3 id="billing-lifecycle-heading" className={dashboardWorkspaceUi.subsectionTitle}>
        {t("business.billing.lifecycle.title")}
      </h3>

      {hasTrialConversion && billing.trialEndsAt ? (
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t("business.billing.lifecycle.trialConversion", {
            date: formatDate(billing.trialEndsAt, locale, t("business.billing.notApplicable")),
          })}
        </p>
      ) : null}

      {hasCancellationDetails ? (
        <>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t("business.billing.lifecycle.cancellationEffective")}:{" "}
            <span className="font-medium text-foreground">
              {formatDate(cancellationEffective, locale, t("business.billing.notApplicable"))}
            </span>
          </p>
          <p className="mt-2 text-sm text-amber-800 dark:text-amber-200" role="status">
            {t("business.billing.lifecycle.cancelScheduledNotice", {
              date: formatDate(cancellationEffective, locale, t("business.billing.notApplicable")),
            })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {billing.cancelAtPeriodEnd
              ? t("business.billing.lifecycle.billingStopsOn")
              : t("business.billing.lifecycle.billingContinues")}
            {renewalDate
              ? ` ${formatDate(renewalDate, locale, t("business.billing.notApplicable"))}`
              : null}
          </p>
        </>
      ) : null}
    </section>
  );
}
