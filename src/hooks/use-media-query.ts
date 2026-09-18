import { useSyncExternalStore } from "react";

/**
 * Sync `matchMedia` on the first client render (no `useState(false)` false-start).
 * CSR-only apps still pass `getServerSnapshot` for React 18 compliance.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
