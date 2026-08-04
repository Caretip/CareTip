import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QrCodeItem } from "@/types/qr";
import { useUserStore } from "@/store/userStore";
import { clearBrandedQrImageCaches } from "@/utils/brandedQrImageCache";
import {
  EMPLOYEE_QR_KEY_PREFIX,
  LEGACY_EMPLOYEE_QR_KEY,
  LEGACY_OFFLINE_QR_KEY,
  OFFLINE_QR_KEY_PREFIX,
  buildOfflineQrEnvelope,
  employeeQrStorageKey,
  isOfflineQrWriteAllowed,
  offlineQrStorageKey,
  parseEmployeeQrEnvelope,
  parseOfflineQrEnvelope,
  type EmployeeQrCacheEnvelope,
} from "@/utils/offlineQrTenantIsolation";

export type EmployeeQrCache = Omit<EmployeeQrCacheEnvelope, "userId">;

async function wipeLegacyUnscopedQrKeys(): Promise<void> {
  await AsyncStorage.multiRemove([LEGACY_OFFLINE_QR_KEY, LEGACY_EMPLOYEE_QR_KEY]);
}

export async function saveOfflineQrItems(
  userId: string,
  items: QrCodeItem[],
  businessId?: string | null,
): Promise<void> {
  const currentUserId = useUserStore.getState().user?.id ?? null;
  if (!isOfflineQrWriteAllowed(userId, currentUserId)) {
    return;
  }
  await wipeLegacyUnscopedQrKeys();
  const envelope = buildOfflineQrEnvelope({ userId, businessId, items });
  await AsyncStorage.setItem(offlineQrStorageKey(userId), JSON.stringify(envelope));
}

export async function loadOfflineQrItems(userId: string | null): Promise<QrCodeItem[]> {
  await wipeLegacyUnscopedQrKeys();
  if (!userId) return [];
  const raw = await AsyncStorage.getItem(offlineQrStorageKey(userId));
  if (!raw) return [];
  return parseOfflineQrEnvelope(raw, userId);
}

export async function saveEmployeeQrCache(
  userId: string,
  data: EmployeeQrCache,
): Promise<void> {
  const currentUserId = useUserStore.getState().user?.id ?? null;
  if (!isOfflineQrWriteAllowed(userId, currentUserId)) {
    return;
  }
  await wipeLegacyUnscopedQrKeys();
  const envelope: EmployeeQrCacheEnvelope = {
    userId,
    url: data.url,
    name: data.name,
    businessName: data.businessName,
    cachedAt: data.cachedAt,
  };
  await AsyncStorage.setItem(employeeQrStorageKey(userId), JSON.stringify(envelope));
}

export async function loadEmployeeQrCache(
  userId: string | null,
): Promise<EmployeeQrCache | null> {
  await wipeLegacyUnscopedQrKeys();
  if (!userId) return null;
  const raw = await AsyncStorage.getItem(employeeQrStorageKey(userId));
  if (!raw) return null;
  const parsed = parseEmployeeQrEnvelope(raw, userId);
  if (!parsed) return null;
  return {
    url: parsed.url,
    name: parsed.name,
    businessName: parsed.businessName,
    cachedAt: parsed.cachedAt,
  };
}

export async function clearEmployeeQrCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const employeeKeys = keys.filter(
    (k) => k === LEGACY_EMPLOYEE_QR_KEY || k.startsWith(EMPLOYEE_QR_KEY_PREFIX),
  );
  if (employeeKeys.length > 0) {
    await AsyncStorage.multiRemove(employeeKeys);
  }
}

export async function clearOfflineQrItems(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const offlineKeys = keys.filter(
    (k) => k === LEGACY_OFFLINE_QR_KEY || k.startsWith(OFFLINE_QR_KEY_PREFIX),
  );
  if (offlineKeys.length > 0) {
    await AsyncStorage.multiRemove(offlineKeys);
  }
}

/** Clear all QR offline caches on logout / account change (shared-device hygiene). */
export async function clearAllOfflineQrCaches(): Promise<void> {
  await Promise.all([clearOfflineQrItems(), clearEmployeeQrCache(), clearBrandedQrImageCaches()]);
}
