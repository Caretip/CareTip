import { Redirect } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { getDashboardRouteForRole } from "@/utils/routing";

export default function AppHome() {
  const { isHydrated, status, isAuthenticated, user } = useAuth();
  const bootstrapping = !isHydrated || status === "idle" || status === "bootstrapping";

  if (bootstrapping) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href={getDashboardRouteForRole(user?.role)} />;
}
