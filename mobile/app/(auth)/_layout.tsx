import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { BootstrapScreen } from "@/components/brand/BootstrapScreen";
import { getDashboardRouteForRole } from "@/utils/routing";

/**
 * Auth stack — hold branded bootstrap until session is known so Login never flashes.
 */
export default function AuthLayout() {
  const { isHydrated, status, isAuthenticated, user } = useAuth();
  const bootstrapping = !isHydrated || status === "idle" || status === "bootstrapping";

  if (bootstrapping) {
    return <BootstrapScreen />;
  }

  if (isAuthenticated) {
    return <Redirect href={getDashboardRouteForRole(user?.role)} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
        animation: "fade",
      }}
    />
  );
}
