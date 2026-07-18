import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type PricingSpecialConditionsBannerProps = {
  className?: string;
};

export function PricingSpecialConditionsBanner({ className }: PricingSpecialConditionsBannerProps) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        "mx-auto max-w-3xl rounded-xl border border-primary/15 bg-primary/[0.04] px-4 py-4 sm:px-5 sm:py-5",
        className,
      )}
      aria-labelledby="pricing-special-conditions-heading"
    >
      <div className="flex items-start gap-3">
        <span className="caretip-marketing-icon-chip mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <Info className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h3 id="pricing-special-conditions-heading" className="text-sm font-semibold text-foreground">
            {t("staticPages.pricing.specialConditions.title")}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {t("staticPages.pricing.specialConditions.body")}
          </p>
        </div>
      </div>
    </aside>
  );
}
