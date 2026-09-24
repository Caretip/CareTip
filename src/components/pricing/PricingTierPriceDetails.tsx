import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CARETIP_LEGAL_LINKS } from "@/app/lib/caretipLegalLinks";
import type { BillingCycle } from "@/app/data/pricingTypes";
import type { PricingTierKey } from "@/app/data/pricingConfig";

type PricingTierPriceDetailsProps = {
  tierKey: PricingTierKey;
  billingCycle: BillingCycle;
  /** Cycle-specific leading segment (e.g. annual billing hint). */
  feeNote?: string;
  className?: string;
};

/**
 * Template price-details line under the main fee:
 * cycle hint | net excl. VAT | plus transaction fees* (PLV link)
 */
export function PricingTierPriceDetails({
  tierKey,
  billingCycle,
  feeNote = "",
  className,
}: PricingTierPriceDetailsProps) {
  const { t } = useTranslation();
  void billingCycle;

  if (tierKey === "enterprise") {
    const note = feeNote.trim();
    if (!note) return null;
    return <p className={cn("caretip-pricing-tier-card__fee-note", className)}>{note}</p>;
  }

  const segments: ReactNode[] = [];
  if (feeNote.trim()) {
    segments.push(<span key="cycle">{feeNote.trim()}</span>);
  }
  segments.push(
    <span key="net">{t("staticPages.pricing.feeDetailNetExclVat")}</span>,
  );
  segments.push(
    <a
      key="fees"
      href={CARETIP_LEGAL_LINKS.plv.path}
      target="_blank"
      rel="noopener noreferrer"
      className="caretip-pricing-tier-card__fee-note-link"
    >
      {t("staticPages.pricing.feeDetailPlusTransactionFees")}
    </a>,
  );

  return (
    <p className={cn("caretip-pricing-tier-card__fee-note", className)}>
      {segments.map((segment, index) => (
        <span key={index} className="caretip-pricing-tier-card__fee-note-segment">
          {index > 0 ? (
            <span className="caretip-pricing-tier-card__fee-note-sep" aria-hidden>
              {" "}
              |{" "}
            </span>
          ) : null}
          {segment}
        </span>
      ))}
    </p>
  );
}
