import { Redirect } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { BootstrapScreen } from "@/components/brand/BootstrapScreen";
import { getDashboardRouteForRole } from "@/utils/routing";

/**
 * Root entry — branded bootstrap until session hydration finishes.
 * Never flashes Login while still determining auth.
 */
export default function Index() {
  const { status, isHydrated, isAuthenticated, user } = useAuth();

  if (!isHydrated || status === "idle" || status === "bootstrapping") {
    return <BootstrapScreen />;
  }

  if (isAuthenticated) {
    return <Redirect href={getDashboardRouteForRole(user?.role)} />;
  }

  return <Redirect href="/(auth)/login" />;
}
