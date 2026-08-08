import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { useSessionRoutingReady } from "@/hooks/useAppReady";
import { getPostAuthHref } from "@/utils/postAuthNavigation";
import { useAuthStore } from "@/store/authStore";
import { authBrand } from "@/theme/authBrand";

/**
 * Routing switch only — must not mark splash firstScreenReady.
 * Destination screens (auth shell / dashboard LayeredScreen) own that signal.
 */
export default function Index() {
  const { isAuthenticated, user } = useAuth();
  const status = useAuthStore((s) => s.status);
  const routingReady = useSessionRoutingReady();

  if (!routingReady) {
    return <View style={styles.boot} />;
  }

  if (status === "session_recovery") {
    return <Redirect href={"/(auth)/session-recovery" as never} />;
  }

  if (isAuthenticated && user) {
    return <Redirect href={getPostAuthHref(user)} />;
  }

  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    // Match splash orange — never light/white under BrandSplashOverlay.
    backgroundColor: authBrand.orange,
  },
});
