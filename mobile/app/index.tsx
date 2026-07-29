import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { SplashScreenAnchor } from "@/components/brand/SplashScreenAnchor";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getPostAuthHref } from "@/utils/postAuthNavigation";
import { colors } from "@/theme";

export default function Index() {
  const { isAuthenticated, user } = useAuth();
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return (
      <View style={styles.boot}>
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
    backgroundColor: colors.background,
  },
});
