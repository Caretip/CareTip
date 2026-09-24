import type { CareIconName } from "@/components/icons";
import type { FeatureKey } from "@/app/lib/subscriptionCapabilities";
import { TIPS_BASE, tipsSubNavItems } from "./businessDashboardNav";

export type BusinessDashboardQuickAccessItem = {
  id: string;
  labelKey: string;
  href: string;
  icon: CareIconName;
  featureKey?: FeatureKey;
  /** Sidebar parent group label key (for audit/docs). */
  parentLabelKey: string;
  isPrimary?: boolean;
};

const TIPS_QUICK_ACCESS_ICON: Record<string, CareIconName> = {
  transactions: "transactions",
  analytics: "analytics",
};

/** Hero button order — analytics is the primary CTA. */
const TIPS_QUICK_ACCESS_ORDER = ["analytics", "transactions"] as const;

/**
 * Dashboard quick-access destinations — nested Tips child routes only.
 * Sourced from tipsSubNavItems (same hrefs/labels as the sidebar).
 */
export const businessDashboardQuickAccessItems: readonly BusinessDashboardQuickAccessItem[] =
  TIPS_QUICK_ACCESS_ORDER.flatMap((id) => {
    const match = tipsSubNavItems.find((item) => item.href === `${TIPS_BASE}/${id}`);
    if (!match) return [];
    return [
      {
        id,
        labelKey: match.labelKey,
        href: match.href,
        icon: TIPS_QUICK_ACCESS_ICON[id] ?? "tipsActivity",
        featureKey: "featureKey" in match ? match.featureKey : undefined,
        parentLabelKey: "dashboardNav.business.tips",
        isPrimary: id === "analytics",
      },
    ];
  });
