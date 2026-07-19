import { useBusinessVerificationRealtime } from "../hooks/useBusinessVerificationRealtime";

/**
 * Headless: business verification realtime + outcome toasts.
 * Kept outside BusinessLayout so socket status churn does not re-render
 * Sidebar / Header / Outlet.
 */
export function BusinessVerificationRealtimeSync({ enabled }: { enabled: boolean }) {
  useBusinessVerificationRealtime(enabled);
  return null;
}
