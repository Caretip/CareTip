import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandedQrViewerMode } from "@/types/qr";

const STORAGE_PREFIX = "caretip_branded_qr_png_v1";
const STORAGE_PREFIX_V2 = "caretip_branded_qr_png_v2";

export type BrandedQrImageCacheEntry = {
  dataUri: string;
  etag: string;
  cachedAt: string;
  userId: string;
};

/**
 * Branded PNG disk keys are scoped by AuthUser.id.
 * Employee mode previously used a fixed `employee-me` suffix shared across accounts.
 */
export function brandedQrStorageKey(
  userId: string,
  mode: BrandedQrViewerMode,
  targetUrl: string,
): string {
  const urlPart =
    mode === "employee"
      ? "employee-me"
      : createHashLike(targetUrl.trim().toLowerCase());
  return `${STORAGE_PREFIX_V2}:${userId}:${mode}:${urlPart}`;
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
  expectedUserId: string,
): Promise<BrandedQrImageCacheEntry | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BrandedQrImageCacheEntry;
    if (!parsed?.dataUri || !parsed?.etag) return null;
    if (parsed.userId && parsed.userId !== expectedUserId) return null;
    return {
      dataUri: parsed.dataUri,
      etag: parsed.etag,
      cachedAt: parsed.cachedAt ?? "",
      userId: expectedUserId,
    };
  } catch {
    return null;
  }
}

export async function saveBrandedQrImageCache(
  key: string,
  userId: string,
  entry: Omit<BrandedQrImageCacheEntry, "cachedAt" | "userId">,
): Promise<void> {
  const payload: BrandedQrImageCacheEntry = {
    ...entry,
    userId,
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(key, JSON.stringify(payload));
}

export async function clearBrandedQrImageCaches(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const brandedKeys = keys.filter(
    (k) => k.startsWith(`${STORAGE_PREFIX}:`) || k.startsWith(`${STORAGE_PREFIX_V2}:`),
  );
  if (brandedKeys.length > 0) {
    await AsyncStorage.multiRemove(brandedKeys);
  }
}
