import { hasFeature } from "../subscriptionEntitlement.service.js";

/**
 * Server-authoritative unit price for physical QR prints.
 * Pro/Enterprise: included in plan (€0). Basic: catalog price.
 */
export async function resolvePhysicalQrUnitPriceCents(
  businessId: string,
  catalogPriceCents: number,
): Promise<number> {
  if (catalogPriceCents <= 0) return 0;
  if (await hasFeature(businessId, "physicalQrPrintingIncluded")) {
    return 0;
  }
  return catalogPriceCents;
}
