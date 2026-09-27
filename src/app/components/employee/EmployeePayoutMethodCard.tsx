import { useTranslation } from "react-i18next";
import { PayoutDestinationCard } from "../finance/payout/PayoutDestinationCard";

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
  const masked = last4
    ? t("employee.payouts.dashboard.methodMaskedLast4", { last4 })
    : t("employee.payouts.dashboard.methodMasked");

  return (
    <PayoutDestinationCard
      methodLabel={label}
      defaultBadgeLabel={t("employee.payouts.dashboard.methodDefault")}
      maskedDisplay={masked}
      ariaLabel={t("employee.payouts.dashboard.methodCardAria")}
    />
  );
}
