import { Navigate } from "react-router";
import { PLATFORM_BUSINESS_BASE } from "../../../components/platform/platformAdminNav";

/** Legacy URL — subscription invoice failures (not guest tips). */
export function PlatformFailedPaymentsPage() {
  return <Navigate to={`${PLATFORM_BUSINESS_BASE}/subscriptions?filter=failed`} replace />;
}
