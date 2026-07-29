import { Redirect } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getDashboardRouteForRole } from "@/utils/routing";

export default function Index() {
  const { isAuthenticated, user } = useAuth();
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return null;
  }

  if (isAuthenticated) {
    return <Redirect href={getDashboardRouteForRole(user?.role)} />;
  }

  return <Redirect href="/(auth)/login" />;
}
