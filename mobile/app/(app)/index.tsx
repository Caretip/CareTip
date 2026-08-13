import { Redirect } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getDashboardRouteForRole } from "@/utils/routing";
import { useTheme } from "@/hooks/useTheme";

export default function AppHome() {
  const { colors } = useTheme();
  const { isAuthenticated, user } = useAuth();
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href={getDashboardRouteForRole(user?.role)} />;
}
