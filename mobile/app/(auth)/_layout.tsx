import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { getDashboardRouteForRole } from "@/utils/routing";

/**
 * Auth stack — native splash covers bootstrap; render nothing until session is known.
 */
export default function AuthLayout() {
  const { isHydrated, status, isAuthenticated, user } = useAuth();
  const bootstrapping = !isHydrated || status === "idle" || status === "bootstrapping";

  if (bootstrapping) {
    return null;
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
        animationDuration: 280,
      }}
    />
  );
}
