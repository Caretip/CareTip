import { useTranslation } from "react-i18next";
import { Check, Lock, Minus, Sparkles } from "lucide-react";
import type { FeatureKey } from "@/app/lib/subscriptionCapabilities";
import {
  allMarketingPlans,
  isFeatureIncludedInMarketingPlan,
  marketingPlanLabelKey,
} from "@/app/lib/featurePlanInclusion";
import { featureListKeys, getFeatureCatalog } from "@/app/lib/subscriptionFeatureCatalog";
import { ACTIVATION_SHEET_CLOSE_MS } from "@/app/lib/activateCareTipNavigation";
import { UpgradeCta } from "./UpgradeCta";
import type { FeatureInfoIntent } from "./FeatureInfoDrawerContext";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/app/components/ui/sheet";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

type FeatureInfoDrawerProps = {
  featureKey: FeatureKey | null;
  intent?: FeatureInfoIntent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FeatureInfoDrawer({
  featureKey,
  open,
  onOpenChange,
}: FeatureInfoDrawerProps) {
  const { t } = useTranslation();
  if (!featureKey) return null;

  const catalog = getFeatureCatalog(featureKey);
  const benefits = featureListKeys(catalog);

  const closeBeforeNavigate = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.06] via-background to-muted/40 px-6 py-5 pr-12">
          <SheetHeader className="space-y-2 text-left">
            <div className="flex items-center gap-2 text-primary">
              <Lock className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wide">
                {t("subscription.featureInfo.upgradeEyebrow")}
              </span>
            </div>
            <SheetTitle className="text-xl font-semibold tracking-tight">
              {t(catalog.titleKey)}
            </SheetTitle>
            <SheetDescription className="text-sm leading-relaxed text-muted-foreground">
              {t(catalog.benefitKey)}
            </SheetDescription>
          </SheetHeader>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section aria-labelledby="feature-info-benefits-heading">
            <h3
              id="feature-info-benefits-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("subscription.featureInfo.keyBenefits")}
            </h3>
            <ul className="mt-3 space-y-2.5">
              {benefits.map((key) => (
                <li key={key} className="flex items-start gap-2.5 text-sm text-foreground/90">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden />
                  <span>{t(key)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3"
            aria-labelledby="feature-info-plans-heading"
          >
            <h3
              id="feature-info-plans-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("subscription.featureInfo.includedIn")}
            </h3>
            <ul className="mt-3 space-y-2">
              {allMarketingPlans().map((plan) => {
                const included = isFeatureIncludedInMarketingPlan(catalog.requiredTier, plan);
                return (
                  <li
                    key={plan}
                    className={cn(
                      "flex items-center gap-2 text-sm font-medium",
                      included ? "text-foreground" : "text-muted-foreground/55",
                    )}
                  >
                    {included ? (
                      <Check className="caretip-feature-check shrink-0" strokeWidth={2.75} aria-hidden />
                    ) : (
                      <Minus className="h-4 w-4 shrink-0 opacity-40" aria-hidden />
                    )}
                    <span>{t(marketingPlanLabelKey(plan))}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <SheetFooter className="mt-auto flex-col gap-2 border-t border-border/60 bg-muted/10 px-6 py-4">
          <UpgradeCta
            featureKey={featureKey}
            className="w-full justify-center"
            fullWidth
            closeBeforeNavigate={closeBeforeNavigate}
            closeAnimationMs={ACTIVATION_SHEET_CLOSE_MS}
          />
          <Button type="button" variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            {t("dashboardNav.business.premiumDialog.maybeLater")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
