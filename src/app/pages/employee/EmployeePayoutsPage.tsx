import { Navigate, useSearchParams } from "react-router";
import { EMPLOYEE_PAYMENTS_CONNECT_HREF } from "../../components/employee/employeeDashboardNav";

/** Stripe return URL and bookmarks. Redirects to Payments → Connect. */
export function EmployeePayoutsPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.toString();
  return <Navigate to={`${EMPLOYEE_PAYMENTS_CONNECT_HREF}${q ? `?${q}` : ""}`} replace />;
}
