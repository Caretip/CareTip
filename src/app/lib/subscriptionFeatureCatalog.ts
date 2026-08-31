import type { BusinessSubscriptionTier, FeatureKey } from "./subscriptionCapabilities";
import { isEnterpriseFeatureKey, minimumTierForFeature } from "./subscriptionCapabilities";

export type FeatureCatalogEntry = {
  featureKey: FeatureKey;
  titleKey: string;
  benefitKey: string;
  /** i18n keys under `subscription.features.{id}.fN` */
  featureListPrefix: string;
  featureListCount: number;
  requiredTier: BusinessSubscriptionTier;
};

const CATALOG: Record<FeatureKey, FeatureCatalogEntry> = {
  employeeQr: {
    featureKey: "employeeQr",
    titleKey: "subscription.features.employeeQr.title",
    benefitKey: "subscription.features.employeeQr.benefit",
    featureListPrefix: "subscription.features.employeeQr",
    featureListCount: 3,
    requiredTier: "basic",
  },
  locationQr: {
    featureKey: "locationQr",
    titleKey: "subscription.features.locationQr.title",
    benefitKey: "subscription.features.locationQr.benefit",
    featureListPrefix: "subscription.features.locationQr",
    featureListCount: 3,
    requiredTier: "basic",
  },
  tableQr: {
    featureKey: "tableQr",
    titleKey: "subscription.features.tableQr.title",
    benefitKey: "subscription.features.tableQr.benefit",
    featureListPrefix: "subscription.features.tableQr",
    featureListCount: 4,
    requiredTier: "basic",
  },
  teamManagement: {
    featureKey: "teamManagement",
    titleKey: "subscription.features.teamManagement.title",
    benefitKey: "subscription.features.teamManagement.benefit",
    featureListPrefix: "subscription.features.teamManagement",
    featureListCount: 4,
    requiredTier: "basic",
  },
  customerFeedback: {
    featureKey: "customerFeedback",
    titleKey: "subscription.features.customerFeedback.title",
    benefitKey: "subscription.features.customerFeedback.benefit",
    featureListPrefix: "subscription.features.customerFeedback",
    featureListCount: 4,
    requiredTier: "basic",
  },
  tipManagement: {
    featureKey: "tipManagement",
    titleKey: "subscription.features.tipManagement.title",
    benefitKey: "subscription.features.tipManagement.benefit",
    featureListPrefix: "subscription.features.tipManagement",
    featureListCount: 3,
    requiredTier: "basic",
  },
  basicAnalytics: {
    featureKey: "basicAnalytics",
    titleKey: "subscription.features.basicAnalytics.title",
    benefitKey: "subscription.features.basicAnalytics.benefit",
    featureListPrefix: "subscription.features.basicAnalytics",
    featureListCount: 3,
    requiredTier: "basic",
  },
  qrTemplates: {
    featureKey: "qrTemplates",
    titleKey: "subscription.features.qrTemplates.title",
    benefitKey: "subscription.features.qrTemplates.benefit",
    featureListPrefix: "subscription.features.qrTemplates",
    featureListCount: 3,
    requiredTier: "premium",
  },
  physicalQrPrinting: {
    featureKey: "physicalQrPrinting",
    titleKey: "subscription.features.physicalQrPrinting.title",
    benefitKey: "subscription.features.physicalQrPrinting.benefit",
    featureListPrefix: "subscription.features.physicalQrPrinting",
    featureListCount: 3,
    requiredTier: "basic",
  },
  physicalQrPrintingIncluded: {
    featureKey: "physicalQrPrintingIncluded",
    titleKey: "subscription.features.physicalQrPrintingIncluded.title",
    benefitKey: "subscription.features.physicalQrPrintingIncluded.benefit",
    featureListPrefix: "subscription.features.physicalQrPrintingIncluded",
    featureListCount: 3,
    requiredTier: "premium",
  },
  advancedAnalytics: {
    featureKey: "advancedAnalytics",
    titleKey: "subscription.features.advancedAnalytics.title",
    benefitKey: "subscription.features.advancedAnalytics.benefit",
    featureListPrefix: "subscription.features.advancedAnalytics",
    featureListCount: 5,
    requiredTier: "premium",
  },
  csvExport: {
    featureKey: "csvExport",
    titleKey: "subscription.features.csvExport.title",
    benefitKey: "subscription.features.csvExport.benefit",
    featureListPrefix: "subscription.features.csvExport",
    featureListCount: 3,
    requiredTier: "basic",
  },
  multiLocation: {
    featureKey: "multiLocation",
    titleKey: "subscription.features.multiLocation.title",
    benefitKey: "subscription.features.multiLocation.benefit",
    featureListPrefix: "subscription.features.multiLocation",
    featureListCount: 3,
    requiredTier: "premium",
  },
  employeeGoals: {
    featureKey: "employeeGoals",
    titleKey: "subscription.features.employeeGoals.title",
    benefitKey: "subscription.features.employeeGoals.benefit",
    featureListPrefix: "subscription.features.employeeGoals",
    featureListCount: 3,
    requiredTier: "premium",
  },
  customJobTitles: {
    featureKey: "customJobTitles",
    titleKey: "subscription.features.customJobTitles.title",
    benefitKey: "subscription.features.customJobTitles.benefit",
    featureListPrefix: "subscription.features.customJobTitles",
    featureListCount: 3,
    requiredTier: "premium",
  },
  brandingCustomization: {
    featureKey: "brandingCustomization",
    titleKey: "subscription.features.brandingCustomization.title",
    benefitKey: "subscription.features.brandingCustomization.benefit",
    featureListPrefix: "subscription.features.brandingCustomization",
    featureListCount: 3,
    requiredTier: "premium",
  },
  apiAccess: {
    featureKey: "apiAccess",
    titleKey: "subscription.features.apiAccess.title",
    benefitKey: "subscription.features.apiAccess.benefit",
    featureListPrefix: "subscription.features.apiAccess",
    featureListCount: 3,
    requiredTier: "enterprise",
  },
  multiBrand: {
    featureKey: "multiBrand",
    titleKey: "subscription.features.multiBrand.title",
    benefitKey: "subscription.features.multiBrand.benefit",
    featureListPrefix: "subscription.features.multiBrand",
    featureListCount: 3,
    requiredTier: "enterprise",
  },
  customReporting: {
    featureKey: "customReporting",
    titleKey: "subscription.features.customReporting.title",
    benefitKey: "subscription.features.customReporting.benefit",
    featureListPrefix: "subscription.features.customReporting",
    featureListCount: 3,
    requiredTier: "enterprise",
  },
  dedicatedOnboarding: {
    featureKey: "dedicatedOnboarding",
    titleKey: "subscription.features.dedicatedOnboarding.title",
    benefitKey: "subscription.features.dedicatedOnboarding.benefit",
    featureListPrefix: "subscription.features.dedicatedOnboarding",
    featureListCount: 3,
    requiredTier: "enterprise",
  },
  accountManager: {
    featureKey: "accountManager",
    titleKey: "subscription.features.accountManager.title",
    benefitKey: "subscription.features.accountManager.benefit",
    featureListPrefix: "subscription.features.accountManager",
    featureListCount: 3,
    requiredTier: "enterprise",
  },
};

export function getFeatureCatalog(featureKey: FeatureKey): FeatureCatalogEntry {
  const entry = CATALOG[featureKey];
  if (entry) return entry;
  return {
    featureKey,
    titleKey: "subscription.features.generic.title",
    benefitKey: "subscription.features.generic.benefit",
    featureListPrefix: "subscription.features.generic",
    featureListCount: 2,
    requiredTier: isEnterpriseFeatureKey(featureKey) ? "enterprise" : minimumTierForFeature(featureKey),
  };
}

export function featureListKeys(entry: FeatureCatalogEntry): string[] {
  return Array.from({ length: entry.featureListCount }, (_, i) => `${entry.featureListPrefix}.f${i}`);
}
