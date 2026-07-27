import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { getDashboardRouteForRole } from "@/utils/routing";
import { colors, spacing, typography } from "@/theme";

export default function AppHome() {
  const { isHydrated, status, isAuthenticated, user } = useAuth();

  if (!isHydrated || status === "idle" || status === "bootstrapping") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.caption}>Loading your dashboard…</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Redirect href={getDashboardRouteForRole(user?.role)} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    gap: spacing.md,
  },
  caption: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
});
