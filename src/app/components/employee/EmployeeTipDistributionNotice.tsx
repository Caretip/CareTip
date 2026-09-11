import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";

export function EmployeeTipDistributionNotice(props: {
  businessName?: string | null;
}) {
  const { t } = useTranslation();
  const name = props.businessName?.trim() ?? "";
  const title = name
    ? t("employee.payouts.distribution.titleNamed", { name })
    : t("employee.payouts.distribution.title");

  return (
    <section
      className="rounded-xl border border-border bg-muted/30 px-4 py-4"
      aria-labelledby="employee-tip-distribution-heading"
    >
      <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {t("employee.payouts.distribution.kicker")}
      </p>
      <div className="mt-2 flex gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Building2 className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id="employee-tip-distribution-heading" className="text-sm font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-sm leading-snug text-muted-foreground">{t("employee.payouts.distribution.body")}</p>
          <p className="text-xs leading-snug text-muted-foreground">{t("employee.payouts.distribution.note")}</p>
        </div>
      </div>
    </section>
  );
}
