import {
  clearBusinessStatsClientCache,
  clearBusinessBrandingSettingsClientCache,
  clearBusinessProfileClientCache,
  clearPhysicalQrPrintClientCache,
  clearEmployeeAccountClientCache,
  clearEmployeeProfileClientCache,
  clearEmployeeTipsClientCache,
} from "./api";
import { clearAllPageSessionCache } from "./pageSessionCache";
import { clearSubscriptionTierSession } from "./subscriptionSessionCache";
import { clearBusinessDashboardSwrStore } from "../hooks/useBusinessDashboardStats";
import { clearEmployeeAccountSwrStore } from "../hooks/useEmployeeAccountSummary";
import { clearVenueCatalogStore } from "./businessVenueCatalog";
import { clearBusinessActivitySearchSnapshot } from "./businessActivitySearchSnapshot";
import { resetQrStudioWarmCache } from "./qrStudioWarmCache";
import { clearPrintQrStudioSessionCache } from "./printQrStudioSessionCache";
import { clearPhysicalQrOrdersSessionCache } from "./physicalQrOrdersSessionCache";
import { clearEmployeePageSessionCache } from "./employeePageSessionCache";
import { clearEmployeePeriodSwrStore } from "./employeePeriodSessionCache";
import { clearCheckoutIntent, clearCheckoutSyncExpectation } from "./checkoutIntent";

/**
 * Wipe in-memory session caches on logout and account switch.
 * Prevents cross-account dashboard / profile data from persisting in the SPA.
 */
export function resetAllClientSessionCaches(): void {
  clearBusinessStatsClientCache();
  clearBusinessProfileClientCache();
  clearEmployeeTipsClientCache();
  clearEmployeeAccountClientCache();
  clearEmployeeProfileClientCache();
  clearAllPageSessionCache();
  clearSubscriptionTierSession();
  clearBusinessDashboardSwrStore();
  clearEmployeePeriodSwrStore();
  clearEmployeeAccountSwrStore();
  clearVenueCatalogStore();
  clearBusinessActivitySearchSnapshot();
  clearBusinessBrandingSettingsClientCache();
  resetQrStudioWarmCache();
  clearPrintQrStudioSessionCache();
  clearPhysicalQrOrdersSessionCache();
  clearEmployeePageSessionCache();
  clearPhysicalQrPrintClientCache();
  clearCheckoutIntent();
  clearCheckoutSyncExpectation();
}
