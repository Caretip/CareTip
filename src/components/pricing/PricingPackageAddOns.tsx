import { Briefcase } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type PricingPackageAddOnsProps = {
  className?: string;
};

/** Optional business services — not included in software subscription tiers. */
export function PricingPackageAddOns({ className }: PricingPackageAddOnsProps) {
  const { t } = useTranslation();

  const serviceKeys = [
    "qrStand",
    "merchandise",
    "customOnboarding",
    "staffTraining",
    "deploymentAssistance",
  ] as const;

  return (
    <aside
      className={cn(
        "mx-auto max-w-3xl rounded-xl border border-border/60 bg-muted/30 px-4 py-4 sm:px-5",
        className,
      )}
      aria-labelledby="pricing-additional-services-heading"
    >
      <div className="flex items-start gap-3">
        <span className="caretip-marketing-icon-chip mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <Briefcase className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h3 id="pricing-additional-services-heading" className="text-sm font-semibold text-foreground">
            {t("staticPages.pricing.additionalServices.title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("staticPages.pricing.additionalServices.subtitle")}</p>
          <ul className="mt-3 space-y-1.5 text-sm text-foreground">
            {serviceKeys.map((key) => (
              <li key={key} className="flex gap-2">
                <span className="text-primary" aria-hidden>
                  •
                </span>
                <span>{t(`staticPages.pricing.additionalServices.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
