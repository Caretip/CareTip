import { View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useAuthLogoutTransitionActive } from "@/hooks/useAuthLogoutTransition";
import { isAuthenticatedAppShellEligible } from "@/lib/authLogoutTransition";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getPostAuthHref, resolvePostAuthAction } from "@/utils/postAuthNavigation";
import { useTheme } from "@/hooks/useTheme";
import { authBrand } from "@/theme/authBrand";

export default function AppLayout() {
  const { colors } = useTheme();
  const { isAuthenticated, user, status } = useAuth();
  const routingReady = useSessionRoutingReady();
  const logoutTransition = useAuthLogoutTransitionActive();

  if (!routingReady) {
    // Opaque boot stub while session resolves under the native splash (not a React splash).
    return <View style={{ flex: 1, backgroundColor: authBrand.orange }} />;
  }

  if (status === "session_recovery") {
    return <Redirect href={"/(auth)/session-recovery" as never} />;
  }

  // Logout / unauth: do not paint the dashboard Stack. Hold the auth canvas
  // (not orange/white) so Redirect does not flash a hole through the splash gate.
  if (!isAuthenticatedAppShellEligible(isAuthenticated) || logoutTransition) {
    return (
      <View style={{ flex: 1, backgroundColor: authBrand.dark }}>
        <Redirect href="/(auth)/login" />
      </View>
    );
  }

  if (user) {
    const action = resolvePostAuthAction(user);
    if (action.kind === "verify-email" || action.kind === "onboarding") {
      return <Redirect href={getPostAuthHref(user)} />;
    }
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "slide_from_right",
        animationDuration: 240,
      }}
    />
  );
}
