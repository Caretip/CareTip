import * as SecureStore from "expo-secure-store";
import { STORAGE_KEYS } from "@/constants/storageKeys";
import type { AuthUser } from "@/types/auth";

/**
 * Secure token vault — Expo SecureStore (Keychain / Keystore).
 * Access JWT + refresh cookie value only; never AsyncStorage.
 */

async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function getItem(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export async function saveAccessToken(token: string): Promise<void> {
  await setItem(STORAGE_KEYS.accessToken, token);
}

export async function getAccessToken(): Promise<string | null> {
  return getItem(STORAGE_KEYS.accessToken);
}

export async function clearAccessToken(): Promise<void> {
  await deleteItem(STORAGE_KEYS.accessToken);
}

/**
 * Stores the opaque refresh token value that the backend normally puts in
 * the HttpOnly `caretip_refresh` cookie. Native clients cannot rely on
 * browser cookie jars, so we mirror the cookie value into SecureStore and
 * re-send it as a `Cookie` header on refresh/logout.
 */
export async function saveRefreshToken(token: string): Promise<void> {
  await setItem(STORAGE_KEYS.refreshToken, token);
}

export async function getRefreshToken(): Promise<string | null> {
  return getItem(STORAGE_KEYS.refreshToken);
}

export async function clearRefreshToken(): Promise<void> {
  await deleteItem(STORAGE_KEYS.refreshToken);
}

export async function saveUserSnapshot(user: AuthUser): Promise<void> {
  await setItem(STORAGE_KEYS.userSnapshot, JSON.stringify(user));
}

export async function getUserSnapshot(): Promise<AuthUser | null> {
  const raw = await getItem(STORAGE_KEYS.userSnapshot);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export async function clearUserSnapshot(): Promise<void> {
  await deleteItem(STORAGE_KEYS.userSnapshot);
}

export async function clearAllSessionSecrets(): Promise<void> {
  await Promise.all([clearAccessToken(), clearRefreshToken(), clearUserSnapshot()]);
}
