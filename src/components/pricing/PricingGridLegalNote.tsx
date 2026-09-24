import { Trans, useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { CARETIP_LEGAL_LINKS } from "@/app/lib/caretipLegalLinks";

type PricingGridLegalNoteProps = {
  className?: string;
};

/** Footer under the pricing grid — B2B net prices, VAT, PLV, free standard payouts. */
export function PricingGridLegalNote({ className }: PricingGridLegalNoteProps) {
  const { t } = useTranslation();

  return (
    <p className={cn("caretip-pricing-grid-legal-note", className)}>
      <Trans
        i18nKey="staticPages.pricing.gridLegalNote"
        components={{
          plv: (
            <a
              href={CARETIP_LEGAL_LINKS.plv.path}
              target="_blank"
              rel="noopener noreferrer"
              className="caretip-pricing-grid-legal-note__link"
            />
          ),
        }}
      />
      <span className="sr-only">{t("staticPages.pricing.gridLegalNoteAria")}</span>
    </p>
  );
}
