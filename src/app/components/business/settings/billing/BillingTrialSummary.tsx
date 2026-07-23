import { useTranslation } from "react-i18next";
import { Clock, Sparkles } from "lucide-react";
import type { BillingStatus } from "../../../../lib/api";

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
 * Trial status banner — shown during an active Stripe trial without replacing existing billing info.
 */
export function BillingTrialSummary({ billing }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith("de") ? "de-DE" : "en-GB";

  const showTrial =
    billing.isTrial || billing.status === "trialing" || billing.trialDaysRemaining != null;
  if (!showTrial || !billing.trialEndsAt) {
    return null;
  }

  const daysRemaining = billing.trialDaysRemaining ?? 0;
  const conversionDate = formatDate(
    billing.trialEndsAt,
    locale,
    t("business.billing.notApplicable"),
  );
  const trialStartDate = formatDate(
    billing.trialStartedAt,
    locale,
    t("business.billing.notApplicable"),
  );

  return (
    <section
      className="rounded-xl border border-emerald-200/80 bg-emerald-50/80 p-4 shadow-sm dark:border-emerald-800/50 dark:bg-emerald-950/30"
      aria-labelledby="billing-trial-heading"
      role="status"
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t("business.billing.trial.badge")}
        </span>
        <div className="min-w-0 flex-1">
          <h4 id="billing-trial-heading" className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">
            {t("business.billing.trial.activeTitle")}
          </h4>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-200">
            <Clock className="h-4 w-4 shrink-0" aria-hidden />
            {t("business.billing.trial.daysRemaining", { count: daysRemaining })}
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-emerald-900/90 dark:text-emerald-100/90 sm:grid-cols-2">
            <div>
              <dt className="font-medium">{t("business.billing.trial.startDate")}</dt>
              <dd>{trialStartDate}</dd>
            </div>
            <div>
              <dt className="font-medium">{t("business.billing.trial.endDate")}</dt>
              <dd>{conversionDate}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-emerald-900/80 dark:text-emerald-100/80">
            {t("business.billing.trial.autoRenewNotice", { date: conversionDate })}
          </p>
        </div>
      </div>
    </section>
  );
}
