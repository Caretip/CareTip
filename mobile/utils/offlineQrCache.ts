import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QrCodeItem } from "@/types/qr";

const OFFLINE_QR_KEY = "caretip_offline_qr_cache_v1";

export async function saveOfflineQrItems(items: QrCodeItem[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QR_KEY, JSON.stringify(items));
}

export async function loadOfflineQrItems(): Promise<QrCodeItem[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QR_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as QrCodeItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const EMPLOYEE_QR_KEY = "caretip_employee_qr_cache_v1";

export type EmployeeQrCache = {
  url: string;
  name: string;
  businessName: string;
  cachedAt: string;
};

export async function saveEmployeeQrCache(data: EmployeeQrCache): Promise<void> {
  await AsyncStorage.setItem(EMPLOYEE_QR_KEY, JSON.stringify(data));
}

export async function loadEmployeeQrCache(): Promise<EmployeeQrCache | null> {
  const raw = await AsyncStorage.getItem(EMPLOYEE_QR_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as EmployeeQrCache;
    return parsed?.url ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearEmployeeQrCache(): Promise<void> {
  await AsyncStorage.removeItem(EMPLOYEE_QR_KEY);
}

export async function clearOfflineQrItems(): Promise<void> {
  await AsyncStorage.removeItem(OFFLINE_QR_KEY);
}

/** Clear all QR offline caches on logout (shared-device hygiene). */
import { clearBrandedQrImageCaches } from "@/utils/brandedQrImageCache";

export async function clearAllOfflineQrCaches(): Promise<void> {
  await Promise.all([clearOfflineQrItems(), clearEmployeeQrCache(), clearBrandedQrImageCaches()]);
}
