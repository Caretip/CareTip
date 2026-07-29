import { useBusinessAnalytics } from "@/features/business/useBusinessAnalytics";

/** Stats-only hook for Performance / Leaderboard — skips QR analytics API. */
export function useBusinessStats() {
  return useBusinessAnalytics({ includeQr: false });
}
