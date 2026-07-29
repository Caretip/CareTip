import { Redirect, Stack, useSegments } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getPostAuthHref, resolvePostAuthAction } from "@/utils/postAuthNavigation";

const AUTH_RECOVERY_ROUTES = new Set(["verify-email", "onboarding", "mfa"]);

export default function AuthLayout() {
  const { isAuthenticated, user } = useAuth();
  const routingReady = useSessionRoutingReady();
  const segments = useSegments();
  const currentRoute = segments[segments.length - 1] ?? "";

  if (!routingReady) {
    return null;
  }

  if (isAuthenticated && user) {
    const action = resolvePostAuthAction(user);

    if (AUTH_RECOVERY_ROUTES.has(currentRoute)) {
      if (currentRoute === "verify-email" && action.kind !== "verify-email") {
        return <Redirect href={getPostAuthHref(user)} />;
      }
      if (currentRoute === "onboarding" && action.kind !== "onboarding") {
        return <Redirect href={getPostAuthHref(user)} />;
      }
      if (currentRoute === "mfa") {
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
    } else {
      return <Redirect href={getPostAuthHref(user)} />;
    }
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
