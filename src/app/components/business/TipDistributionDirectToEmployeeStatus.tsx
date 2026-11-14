import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

/**
 * Direct-to-employee routing notice. Informational only: the workspace below stays visible so the
 * business can still see shares it received under business distribution and its distribution history.
 */
export function TipDistributionDirectToEmployeeStatus(props: { outstandingCents: number }) {
  const { t } = useTranslation();
  const hasOutstanding = props.outstandingCents > 0;

  return (
    <div
      className="mb-4 flex max-w-prose gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
      role="status"
      aria-labelledby="tip-distribution-direct-to-employee-heading"
      data-tip-distribution-mode="direct_to_employee"
    >
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground"
        aria-hidden
      >
        <Info className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 space-y-1">
        <h2 id="tip-distribution-direct-to-employee-heading" className="text-sm font-medium text-foreground">
          {t("business.tipDistribution.directToEmployee.modeTitle")}
        </h2>
        <p className="text-sm leading-snug text-muted-foreground">
          {t(
            hasOutstanding
              ? "business.tipDistribution.directToEmployee.modeBodyOutstanding"
              : "business.tipDistribution.directToEmployee.modeBody",
          )}
        </p>
      </div>
    </div>
  );
}
