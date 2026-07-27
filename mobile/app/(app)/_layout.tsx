import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { BootstrapScreen } from "@/components/brand/BootstrapScreen";
import { colors } from "@/theme";

export default function AppLayout() {
  const { isHydrated, status, isAuthenticated } = useAuth();
  const bootstrapping = !isHydrated || status === "idle" || status === "bootstrapping";

  if (bootstrapping) {
    return <BootstrapScreen />;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
