import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UpgradeCta } from "@/app/components/subscription/UpgradeCta";
import { cn } from "@/lib/utils";

type LocationsMultiLocationUpgradeCardProps = {
  className?: string;
};

/**
 * Basic-plan awareness card for Locations — Fanny copy, existing UpgradeCta flow.
 */
export function LocationsMultiLocationUpgradeCard({
  className,
}: LocationsMultiLocationUpgradeCardProps) {
  const { t } = useTranslation();
  const featureKeys = ["f0", "f1", "f2"] as const;

  return (
    <section
      className={cn(
        "rounded-2xl border border-orange-200/80 bg-[linear-gradient(180deg,rgb(255_247_237)_0%,rgb(255_255_255)_100%)] p-5 shadow-sm sm:p-6",
        "dark:border-orange-900/40 dark:bg-[linear-gradient(180deg,rgb(67_32_11_/_0.28)_0%,rgb(24_24_27)_100%)]",
        className,
      )}
      aria-labelledby="locations-upgrade-title"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#e9781c]">
        {t("subscription.features.multiLocation.upgradeRequired")}
      </p>
      <h2
        id="locations-upgrade-title"
        className="mt-2 text-lg font-semibold tracking-tight text-foreground sm:text-xl"
      >
        {t("subscription.features.multiLocation.title")}
      </h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {t("subscription.features.multiLocation.benefit")}
      </p>

      <ul className="mt-4 space-y-2" aria-label={t("subscription.locked.includesAria")}>
        {featureKeys.map((key) => (
          <li key={key} className="flex items-start gap-2 text-sm text-foreground">
            <Check className="caretip-feature-check mt-0.5 shrink-0" strokeWidth={2.75} aria-hidden />
            <span>{t(`subscription.features.multiLocation.${key}`)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        {t("subscription.features.multiLocation.footer")}
      </p>

      <div className="mt-5">
        <UpgradeCta
          featureKey="multiLocation"
          variant="primary"
          labelKey="subscription.features.multiLocation.upgradeCta"
          className="w-full sm:w-auto"
        />
      </div>
    </section>
  );
}
