import { View } from "react-native";
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getPostAuthHref, resolvePostAuthAction } from "@/utils/postAuthNavigation";
import { useTheme } from "@/hooks/useTheme";
import { authBrand } from "@/theme/authBrand";

export default function AppLayout() {
  const { colors } = useTheme();
  const { isAuthenticated, user, status } = useAuth();
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return <View style={{ flex: 1, backgroundColor: authBrand.orange }} />;
  }

  if (status === "session_recovery") {
    return <Redirect href={"/(auth)/session-recovery" as never} />;
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
