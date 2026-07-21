/**
 * Session-scoped in-memory cache for secondary pages (never localStorage).
 * Reuses the dashboard SWR store pattern for cache-first navigation.
 */

import { createDashboardSwrStore } from "./dashboardSwrCache";

/** QR codes, locations, tables, settings panels, business profile form. */
export const PAGE_CACHE_TTL_LOW_MS = 15 * 60 * 1000;

/** Staff roster, goals, admin directory lists. */
export const PAGE_CACHE_TTL_MEDIUM_MS = 5 * 60 * 1000;

/** Notifications inbox (same filter), transactions with active filters. */
export const PAGE_CACHE_TTL_HIGH_MS = 2 * 60 * 1000;

const pageStore = createDashboardSwrStore<unknown>();

export function getPageSessionCache<T>(key: string, ttlMs: number): T | null {
  return pageStore.get(key, ttlMs) as T | null;
}

export function setPageSessionCache<T>(key: string, value: T): void {
  pageStore.set(key, value);
}

export function invalidatePageSessionCache(key: string): void {
  pageStore.delete(key);
}

export function invalidatePageSessionCacheByPrefix(prefix: string): void {
  pageStore.deleteByPrefix(prefix);
}

export function clearAllPageSessionCache(): void {
  pageStore.clear();
}

/** Session-cache peek for client-side global search (no TTL eviction). */
export function peekPageSessionCache<T>(key: string): T | null {
  return pageStore.peek(key) as T | null;
}

export function peekPageSessionCacheByPrefix<T>(
  prefix: string,
): Array<{ key: string; value: T; at: number }> {
  return pageStore.entriesByPrefix(prefix) as Array<{ key: string; value: T; at: number }>;
}
