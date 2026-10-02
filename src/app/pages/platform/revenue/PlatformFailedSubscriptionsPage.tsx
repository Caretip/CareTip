import { Navigate } from "react-router";
import { PLATFORM_BUSINESS_BASE } from "../../../components/platform/platformAdminNav";

/** Legacy URL — past-due subscriptions. */
export function PlatformFailedSubscriptionsPage() {
  return <Navigate to={`${PLATFORM_BUSINESS_BASE}/subscriptions?filter=past_due`} replace />;
}
