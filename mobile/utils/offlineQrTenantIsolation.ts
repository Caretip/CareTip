import type { QrCodeItem } from "@/types/qr";

/** Legacy device-global keys — never hydrate; wipe on any QR cache touch. */
export const LEGACY_OFFLINE_QR_KEY = "caretip_offline_qr_cache_v1";
export const LEGACY_EMPLOYEE_QR_KEY = "caretip_employee_qr_cache_v1";

export const OFFLINE_QR_KEY_PREFIX = "caretip_offline_qr_cache_v2:";
export const EMPLOYEE_QR_KEY_PREFIX = "caretip_employee_qr_cache_v2:";

export type OfflineQrEnvelope = {
  userId: string;
  businessId: string | null;
  savedAt: string;
  items: QrCodeItem[];
};

export type EmployeeQrCacheEnvelope = {
  userId: string;
  url: string;
  name: string;
  businessName: string;
  cachedAt: string;
};

export function offlineQrStorageKey(userId: string): string {
  return `${OFFLINE_QR_KEY_PREFIX}${userId}`;
}

export function employeeQrStorageKey(userId: string): string {
  return `${EMPLOYEE_QR_KEY_PREFIX}${userId}`;
}

/** True when an in-flight save still belongs to the signed-in user. */
export function isOfflineQrWriteAllowed(
  intendedUserId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  return Boolean(intendedUserId && currentUserId && intendedUserId === currentUserId);
}

/**
 * Studio list resolution — never paint offline inventory while live fetch is in flight.
 * Live tenant data always wins; offline is same-user offline UX only after load settles.
 */
export function resolveQrStudioDisplayItems(input: {
  liveItems: QrCodeItem[];
  offlineItems: QrCodeItem[];
  isLoading: boolean;
}): QrCodeItem[] {
  if (input.liveItems.length > 0) return input.liveItems;
  if (input.isLoading) return [];
  return input.offlineItems;
}

export function parseOfflineQrEnvelope(
  raw: string,
  expectedUserId: string,
): QrCodeItem[] {
  try {
    const parsed = JSON.parse(raw) as OfflineQrEnvelope | QrCodeItem[];
    // Refuse bare arrays (legacy / unscoped shape under any key).
    if (Array.isArray(parsed)) return [];
    if (!parsed || typeof parsed !== "object") return [];
    if (parsed.userId !== expectedUserId) return [];
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export function parseEmployeeQrEnvelope(
  raw: string,
  expectedUserId: string,
): EmployeeQrCacheEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as EmployeeQrCacheEnvelope & { url?: string };
    if (!parsed?.url || parsed.userId !== expectedUserId) return null;
    return {
      userId: parsed.userId,
      url: parsed.url,
      name: parsed.name ?? "",
      businessName: parsed.businessName ?? "",
      cachedAt: parsed.cachedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function buildOfflineQrEnvelope(input: {
  userId: string;
  businessId?: string | null;
  items: QrCodeItem[];
}): OfflineQrEnvelope {
  return {
    userId: input.userId,
    businessId: input.businessId ?? null,
    savedAt: new Date().toISOString(),
    items: input.items,
  };
}
