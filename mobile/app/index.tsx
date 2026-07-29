import { Redirect } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { getDashboardRouteForRole } from "@/utils/routing";

/**
 * Root entry — native splash stays visible until ready; redirect once session is known.
 */
export default function Index() {
  const { status, isHydrated, isAuthenticated, user } = useAuth();
  const bootstrapping = !isHydrated || status === "idle" || status === "bootstrapping";

  if (bootstrapping) {
    return null;
  }

  if (isAuthenticated) {
    return <Redirect href={getDashboardRouteForRole(user?.role)} />;
  }

  return <Redirect href="/(auth)/login" />;
}
