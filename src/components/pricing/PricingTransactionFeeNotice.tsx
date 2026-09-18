import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CARETIP_LEGAL_LINKS } from "@/app/lib/caretipLegalLinks";

type PricingTransactionFeeNoticeProps = {
  className?: string;
};

/** Shared red transaction-fee line — plan name → notice → price on every tier card. */
export function PricingTransactionFeeNotice({ className }: PricingTransactionFeeNoticeProps) {
  const { t } = useTranslation();

  return (
    <p className={cn("caretip-pricing-tier-card__transaction-fee-notice", className)}>
      <Link
        to={CARETIP_LEGAL_LINKS.plv.path}
        className="caretip-pricing-tier-card__transaction-fee-notice-link"
      >
        {t("staticPages.pricing.transactionFeeNotice")}
      </Link>
    </p>
  );
}
