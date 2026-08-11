import { View } from "react-native";
import { Redirect, Stack, useSegments } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useAuthLogoutTransitionActive } from "@/hooks/useAuthLogoutTransition";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { authBrand } from "@/theme/authBrand";
import { getPostAuthHref, resolvePostAuthAction } from "@/utils/postAuthNavigation";

const AUTH_RECOVERY_ROUTES = new Set(["verify-email", "onboarding", "mfa", "session-recovery"]);

export default function AuthLayout() {
  const { isAuthenticated, user, status } = useAuth();
  const routingReady = useSessionRoutingReady();
  const logoutTransition = useAuthLogoutTransitionActive();
  const segments = useSegments();
  const currentRoute = segments[segments.length - 1] ?? "";

  if (!routingReady) {
    // Match splash orange — avoid a blank/null frame under the overlay.
    return <View style={{ flex: 1, backgroundColor: authBrand.orange }} />;
  }

  if (status === "session_recovery") {
    const onSessionRecovery = (segments as string[]).includes("session-recovery");
    if (!onSessionRecovery) {
      return <Redirect href={"/(auth)/session-recovery" as never} />;
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

  // Do not bounce back to the dashboard while Sign Out is tearing down.
  if (isAuthenticated && user && !logoutTransition) {
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
        contentStyle: { backgroundColor: logoutTransition ? authBrand.dark : "transparent" },
        animation: logoutTransition ? "none" : "fade",
        animationDuration: logoutTransition ? 0 : 280,
      }}
    />
  );
}
