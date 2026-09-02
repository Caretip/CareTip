import type { FeatureKey } from "@/app/lib/subscriptionCapabilities";
import { minimumTierForFeature } from "@/app/lib/subscriptionCapabilities";
import {
  isEntitlementsSessionPrimed,
  sessionHasActiveEntitlements,
  sessionHasFeature,
} from "@/app/lib/subscriptionEntitlementFastPath";

export type SidebarNavLockReason = "none" | "upgrade_required";

export type SidebarNavEntitlementView = {
  ready: boolean;
  hasActiveEntitlements: boolean;
  hasFeature: (featureKey: FeatureKey) => boolean;
};

const ALWAYS_OPEN_PREFIXES = [
  "/dashboard/billing",
  "/dashboard/stripe",
  "/dashboard/settings",
  "/dashboard/qr-studio",
  "/dashboard/locations",
] as const;

const GROUP_MODULE_FEATURE: Record<string, FeatureKey> = {
  "qr-studio": "employeeQr",
  team: "teamManagement",
  customers: "customerFeedback",
  tips: "tipManagement",
};

function isAlwaysOpenHref(href: string): boolean {
  if (href === "/dashboard") return true;
  return ALWAYS_OPEN_PREFIXES.some(
    (prefix) => href === prefix || href.startsWith(`${prefix}/`) || href.startsWith(`${prefix}?`),
  );
}

export function resolveSidebarNavEntitlements(
  entitlements: SidebarNavEntitlementView,
): SidebarNavEntitlementView {
  if (entitlements.ready) return entitlements;
  if (!isEntitlementsSessionPrimed()) {
    return {
      ready: false,
      hasActiveEntitlements: false,
      hasFeature: () => false,
    };
  }
  return {
    ready: true,
    hasActiveEntitlements: sessionHasActiveEntitlements(),
    hasFeature: sessionHasFeature,
  };
}

export function resolveSidebarNavLock(
  href: string,
  featureKey: FeatureKey | undefined,
  groupId: string | undefined,
  entitlements: SidebarNavEntitlementView,
): {
  locked: boolean;
  reason: SidebarNavLockReason;
  dialogFeatureKey: FeatureKey;
} {
  const view = resolveSidebarNavEntitlements(entitlements);
  const dialogFeatureKey =
    featureKey ?? (groupId ? GROUP_MODULE_FEATURE[groupId] : undefined) ?? "tipManagement";

  if (isAlwaysOpenHref(href)) {
    return { locked: false, reason: "none", dialogFeatureKey };
  }

  if (!view.ready) {
    return { locked: false, reason: "none", dialogFeatureKey };
  }

  if (!view.hasActiveEntitlements) {
    return { locked: true, reason: "upgrade_required", dialogFeatureKey };
  }

  if (featureKey && !view.hasFeature(featureKey)) {
    return { locked: true, reason: "upgrade_required", dialogFeatureKey: featureKey };
  }

  return { locked: false, reason: "none", dialogFeatureKey };
}

export function planLabelKeyForFeature(featureKey: FeatureKey): string {
  const tier = minimumTierForFeature(featureKey);
  if (tier === "enterprise") return "dashboardNav.business.planLabels.enterprise";
  if (tier === "premium") return "dashboardNav.business.planLabels.business";
  return "dashboardNav.business.planLabels.starter";
}
