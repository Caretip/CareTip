import type { BusinessActivityFeedItem } from "@/app/lib/api";

/**
 * Lightweight in-memory mirror of Activity Center items for client-side global search.
 * Updated only when the Activity Center feed mutates — no extra network calls.
 */
let snapshot: BusinessActivityFeedItem[] = [];

export function setBusinessActivitySearchSnapshot(items: BusinessActivityFeedItem[]): void {
  snapshot = items;
}

export function getBusinessActivitySearchSnapshot(): BusinessActivityFeedItem[] {
  return snapshot;
}

export function clearBusinessActivitySearchSnapshot(): void {
  snapshot = [];
}
