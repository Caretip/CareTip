import { useTranslation } from "react-i18next";

export function EmployeePayoutMethodCard({
  last4,
  kind,
}: {
  last4: string | null;
  kind: "card" | "bank_account" | null;
}) {
  const { t } = useTranslation();
  const label =
    kind === "card"
      ? t("employee.payouts.dashboard.methodCard")
      : t("employee.payouts.dashboard.methodBank");

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#8b7cff] via-[#7b61ff] to-[#5b4ae0] p-5 text-white shadow-sm"
      aria-label={t("employee.payouts.dashboard.methodCardAria")}
    >
      <div className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/15" />
      <div className="pointer-events-none absolute -bottom-12 right-10 size-28 rounded-full bg-white/10" />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-semibold tracking-tight">{label}</p>
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide">
          {t("employee.payouts.dashboard.methodDefault")}
        </span>
      </div>
      <p className="relative mt-8 font-mono text-lg tracking-[0.28em]">
        {last4 ? `···· ···· ${last4}` : t("employee.payouts.dashboard.methodMasked")}
      </p>
    </div>
  );
}
