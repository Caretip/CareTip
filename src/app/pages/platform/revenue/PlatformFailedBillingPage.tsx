import { Navigate, useSearchParams } from "react-router";
import { PLATFORM_BUSINESS_BASE } from "../../../components/platform/platformAdminNav";

/** Legacy route → Subscription Management with billing-failure filter preset. */
export function PlatformFailedBillingPage() {
  const [searchParams] = useSearchParams();
  const filter = searchParams.get("filter") === "past_due" ? "past_due" : "failed";
  const qs = new URLSearchParams({ filter });
  return <Navigate to={`${PLATFORM_BUSINESS_BASE}/subscriptions?${qs.toString()}`} replace />;
}
