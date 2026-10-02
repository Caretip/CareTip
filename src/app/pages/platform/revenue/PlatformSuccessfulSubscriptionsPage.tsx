import { Navigate } from "react-router";
import { PLATFORM_BUSINESS_BASE } from "../../../components/platform/platformAdminNav";

/** Legacy route → Subscription Management (successful activity filter). */
export function PlatformSuccessfulSubscriptionsPage() {
  return <Navigate to={`${PLATFORM_BUSINESS_BASE}/subscriptions?filter=successful`} replace />;
}
