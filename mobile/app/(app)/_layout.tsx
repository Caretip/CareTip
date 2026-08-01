import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getPostAuthHref, resolvePostAuthAction } from "@/utils/postAuthNavigation";
import { useTheme } from "@/hooks/useTheme";

export default function AppLayout() {
  const { colors } = useTheme();
  const { isAuthenticated, user } = useAuth();
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
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
        animation: "fade",
        animationDuration: 220,
      }}
    />
  );
}
