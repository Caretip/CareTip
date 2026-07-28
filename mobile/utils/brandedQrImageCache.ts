import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandedQrViewerMode } from "@/types/qr";

const STORAGE_PREFIX = "caretip_branded_qr_png_v1";

export type BrandedQrImageCacheEntry = {
  dataUri: string;
  etag: string;
  cachedAt: string;
};

export function brandedQrStorageKey(mode: BrandedQrViewerMode, targetUrl: string): string {
  const urlPart =
    mode === "employee"
      ? "employee-me"
      : createHashLike(targetUrl.trim().toLowerCase());
  return `${STORAGE_PREFIX}:${mode}:${urlPart}`;
}

function createHashLike(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export async function loadBrandedQrImageCache(
  key: string,
): Promise<BrandedQrImageCacheEntry | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BrandedQrImageCacheEntry;
    return parsed?.dataUri && parsed?.etag ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveBrandedQrImageCache(
  key: string,
  entry: Omit<BrandedQrImageCacheEntry, "cachedAt">,
): Promise<void> {
  const payload: BrandedQrImageCacheEntry = {
    ...entry,
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(key, JSON.stringify(payload));
}

export async function clearBrandedQrImageCaches(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const brandedKeys = keys.filter((k) => k.startsWith(`${STORAGE_PREFIX}:`));
  if (brandedKeys.length > 0) {
    await AsyncStorage.multiRemove(brandedKeys);
  }
}
