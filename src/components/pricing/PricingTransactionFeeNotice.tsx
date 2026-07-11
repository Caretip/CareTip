import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type PricingTransactionFeeNoticeProps = {
  className?: string;
};

/** Shared red transaction-fee line — plan name → notice → price on every tier card. */
export function PricingTransactionFeeNotice({ className }: PricingTransactionFeeNoticeProps) {
  const { t } = useTranslation();

  return (
    <p className={cn("caretip-pricing-tier-card__transaction-fee-notice", className)}>
      {t("staticPages.pricing.transactionFeeNotice")}
    </p>
  );
}
