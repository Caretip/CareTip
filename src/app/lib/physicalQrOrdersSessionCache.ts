/**
 * Session-scoped My Orders list + order detail.
 * In-memory only (pageSessionCache). Never localStorage. Cleared on logout.
 */
import type { PhysicalQrCustomerOrder } from "./api";
import {
  getPageSessionCache,
  invalidatePageSessionCache,
  invalidatePageSessionCacheByPrefix,
  setPageSessionCache,
  PAGE_CACHE_TTL_LOW_MS,
} from "./pageSessionCache";

export const PHYSICAL_QR_ORDERS_CACHE_PREFIX = "physical-qr-orders:";
export const PHYSICAL_QR_ORDER_DETAIL_CACHE_PREFIX = "physical-qr-order:";

type PhysicalQrOrdersSnapshot = {
  businessId: string;
  orders: PhysicalQrCustomerOrder[];
};

export function physicalQrOrdersCacheKey(businessId: string): string {
  return `${PHYSICAL_QR_ORDERS_CACHE_PREFIX}${businessId.trim()}`;
}

export function physicalQrOrderDetailCacheKey(businessId: string, orderId: string): string {
  return `${PHYSICAL_QR_ORDER_DETAIL_CACHE_PREFIX}${businessId.trim()}:${orderId.trim()}`;
}

export function readPhysicalQrOrdersSnapshot(
  businessId: string | null | undefined,
): PhysicalQrOrdersSnapshot | null {
  const id = businessId?.trim();
  if (!id) return null;
  const hit = getPageSessionCache<PhysicalQrOrdersSnapshot>(physicalQrOrdersCacheKey(id), PAGE_CACHE_TTL_LOW_MS);
  if (!hit || hit.businessId !== id) return null;
  return hit;
}

export function writePhysicalQrOrdersSnapshot(
  businessId: string,
  orders: PhysicalQrCustomerOrder[],
): void {
  const id = businessId.trim();
  if (!id) return;
  setPageSessionCache(physicalQrOrdersCacheKey(id), { businessId: id, orders });
}

export function readPhysicalQrOrderSnapshot(
  businessId: string | null | undefined,
  orderId: string | null | undefined,
): PhysicalQrCustomerOrder | null {
  const biz = businessId?.trim();
  const oid = orderId?.trim();
  if (!biz || !oid) return null;
  const detail = getPageSessionCache<PhysicalQrCustomerOrder>(
    physicalQrOrderDetailCacheKey(biz, oid),
    PAGE_CACHE_TTL_LOW_MS,
  );
  if (detail && detail.id === oid) return detail;
  const list = readPhysicalQrOrdersSnapshot(biz);
  return list?.orders.find((row) => row.id === oid) ?? null;
}

export function writePhysicalQrOrderSnapshot(
  businessId: string,
  order: PhysicalQrCustomerOrder,
): void {
  const id = businessId.trim();
  if (!id || !order.id) return;
  setPageSessionCache(physicalQrOrderDetailCacheKey(id, order.id), order);
  const prev = readPhysicalQrOrdersSnapshot(id);
  if (!prev) return;
  const rest = prev.orders.filter((row) => row.id !== order.id);
  writePhysicalQrOrdersSnapshot(id, [order, ...rest]);
}

/** After placing an order, seed list + detail so My Orders can paint immediately. */
export function upsertPhysicalQrOrderInListSnapshot(
  businessId: string,
  order: PhysicalQrCustomerOrder,
): void {
  const id = businessId.trim();
  if (!id || !order.id) return;
  setPageSessionCache(physicalQrOrderDetailCacheKey(id, order.id), order);
  const prev = readPhysicalQrOrdersSnapshot(id);
  const rest = (prev?.orders ?? []).filter((row) => row.id !== order.id);
  writePhysicalQrOrdersSnapshot(id, [order, ...rest]);
}

export function invalidatePhysicalQrOrdersSnapshot(businessId: string | null | undefined): void {
  const id = businessId?.trim();
  if (!id) return;
  invalidatePageSessionCache(physicalQrOrdersCacheKey(id));
  invalidatePageSessionCacheByPrefix(`${PHYSICAL_QR_ORDER_DETAIL_CACHE_PREFIX}${id}:`);
}

export function clearPhysicalQrOrdersSessionCache(): void {
  invalidatePageSessionCacheByPrefix(PHYSICAL_QR_ORDERS_CACHE_PREFIX);
  invalidatePageSessionCacheByPrefix(PHYSICAL_QR_ORDER_DETAIL_CACHE_PREFIX);
}
