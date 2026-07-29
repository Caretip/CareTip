import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { colors } from "@/theme";

export default function AppLayout() {
  const { isAuthenticated } = useAuth();
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
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
