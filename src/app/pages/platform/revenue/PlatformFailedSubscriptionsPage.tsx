import { Navigate } from "react-router";
import { PLATFORM_REVENUE_BASE } from "../../../components/platform/platformAdminNav";

/** Legacy URL — past-due subscriptions only; now a filter on Failed billing. */
export function PlatformFailedSubscriptionsPage() {
  return <Navigate to={`${PLATFORM_REVENUE_BASE}/failed-billing?filter=past_due`} replace />;
}
