import { Navigate } from "react-router";
import { PLATFORM_REVENUE_BASE } from "../../../components/platform/platformAdminNav";

/** Legacy URL — Failed Payments was a subscription invoice-failure view, not guest tips. */
export function PlatformFailedPaymentsPage() {
  return <Navigate to={`${PLATFORM_REVENUE_BASE}/failed-billing?filter=failed`} replace />;
}
