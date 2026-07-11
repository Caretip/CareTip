import { useTranslation } from "react-i18next";
import type { BillingCycle } from "@/app/data/pricingTypes";
import { PricingBillingToggle } from "@/components/pricing/PricingBillingToggle";
import { cn } from "@/lib/utils";

type PricingControlsPanelProps = {
  billingCycle: BillingCycle;
  onBillingCycleChange: (cycle: BillingCycle) => void;
  className?: string;
};

export function PricingControlsPanel({
  billingCycle,
  onBillingCycleChange,
  className,
}: PricingControlsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={cn("caretip-pricing-controls caretip-pricing-controls--billing-only", className)}>
      <div className="caretip-pricing-controls__field caretip-pricing-controls__field--billing">
        <span className="caretip-pricing-controls__label" id="pricing-billing-label">
          {t("staticPages.pricing.billing.label")}
        </span>
        <PricingBillingToggle
          value={billingCycle}
          onChange={onBillingCycleChange}
          className="caretip-pricing-billing-toggle--in-panel"
          aria-labelledby="pricing-billing-label"
        />
      </div>
    </div>
  );
}
