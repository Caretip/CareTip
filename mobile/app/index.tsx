import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { useTheme } from "@/hooks/useTheme";
import { getPostAuthHref } from "@/utils/postAuthNavigation";

export default function Index() {
  const { colors } = useTheme();
  const { isAuthenticated, user } = useAuth();
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return (
      <View style={[styles.boot, { backgroundColor: colors.background }]}>
        <SplashScreenAnchor source="index" />
      </View>
    );
  }

  if (isAuthenticated && user) {
    return <Redirect href={getPostAuthHref(user)} />;
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
  },
});
