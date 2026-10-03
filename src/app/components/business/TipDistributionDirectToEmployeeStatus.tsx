import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

/** Direct-to-employee routing — no business distributions to manage (healthy empty state). */
export function TipDistributionDirectToEmployeeStatus() {
  const { t } = useTranslation();

  return (
    <div
      className="flex max-w-prose gap-3 py-1"
      role="status"
      aria-labelledby="tip-distribution-direct-to-employee-heading"
    >
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground"
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 space-y-1">
        <h2 id="tip-distribution-direct-to-employee-heading" className="text-sm font-medium text-foreground">
          {t("business.tipDistribution.directToEmployee.title")}
        </h2>
        <p className="text-sm leading-snug text-muted-foreground">
          {t("business.tipDistribution.directToEmployee.description")}
        </p>
      </div>
    </div>
  );
}
