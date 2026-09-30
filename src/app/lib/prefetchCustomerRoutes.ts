/** Prefetch lazy customer tip-flow chunks after QR landing — faster in-journey navigation. */

type RouteImporter = () => Promise<unknown>;

const CUSTOMER_FLOW_IMPORTERS: Record<string, RouteImporter> = {
  "/tip-amount": () => import("../pages/customer/TipAmountPage"),
  "/payment": () => import("../pages/customer/PaymentPage"),
  "/rating": () => import("../pages/customer/RatingPage"),
};

const prefetched = new Set<string>();

export function prefetchCustomerFlowRoute(path: string): void {
  const normalized = path.split("#")[0].split("?")[0];
  if (!normalized || prefetched.has(normalized)) return;
  const factory = CUSTOMER_FLOW_IMPORTERS[normalized];
  if (!factory) return;
  prefetched.add(normalized);
  void factory();
}

/** Warm tip-flow pages once the customer lands on a QR entry surface. */
export function prefetchCustomerFlowRoutes(): void {
  for (const path of Object.keys(CUSTOMER_FLOW_IMPORTERS)) {
    prefetchCustomerFlowRoute(path);
  }
  void import("@/i18n/i18n").then(({ prefetchCustomerJourneyLocaleBundles }) =>
    prefetchCustomerJourneyLocaleBundles(),
  );
}
