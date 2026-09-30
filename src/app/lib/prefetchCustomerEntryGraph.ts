/**
 * Overlap customer QR route JS with i18n boot on direct URL entry (cold QR scan).
 * Keep in sync with customer routes in routes.tsx.
 */
import { isCustomerJourneyPath } from "./appLoadingJourney";

export function prefetchCustomerEntryGraph(): void {
  if (typeof window === "undefined") return;
  const p = window.location.pathname.split("?")[0]?.split("#")[0] ?? "/";
  if (!isCustomerJourneyPath(p)) return;

  if (p.startsWith("/qr/table/")) {
    void import("../pages/customer/TableQrLandingPage");
    return;
  }
  if (p.startsWith("/qr/location/")) {
    void import("../pages/customer/LocationQrLandingPage");
    return;
  }
  if (p.startsWith("/staff/")) {
    void import("../pages/customer/StaffLandingPage");
    return;
  }
  if (p.startsWith("/qr/employee/")) {
    void import("../pages/customer/EmployeeQrEntryPage");
    return;
  }
  if (
    p.startsWith("/table/") ||
    p.startsWith("/qr-landing/") ||
    p.startsWith("/qr/business/")
  ) {
    void import("../pages/customer/QRLandingPage");
    return;
  }
  if (p === "/tip-amount" || p.startsWith("/tip-amount")) {
    void import("../pages/customer/TipAmountPage");
    return;
  }
  if (p === "/rating" || p === "/success" || p === "/tip-complete" || p === "/payment") {
    void import("../pages/customer/PaymentPage");
    void import("../pages/customer/TipCompletionPage");
    return;
  }
  // `/{businessSlug}` and `/{businessSlug}/{employeeSlug}`
  void import("../pages/customer/StaffTipByPublicPathPage");
  void import("../pages/customer/BusinessStaffDirectoryPage");
  void import("../pages/customer/QRLandingPage");
}
