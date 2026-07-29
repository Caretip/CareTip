import { useEffect, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useNavigationReady } from "@/hooks/useNavigationReady";
import { useSplashStore } from "@/store/splashStore";
import { authBrand } from "@/theme/authBrand";
import { hideSplashOnce, logSplash } from "@/utils/splashLifecycle";

type NativeSplashGateProps = {
  children: ReactNode;
};

/**
 * Keeps the native Expo splash visible until bootstrap, navigation, and the
 * first destination screen have all reported ready.
 */
export function NativeSplashGate({ children }: NativeSplashGateProps) {
  const bootstrapReady = useBootstrapReady();
  const navigationReady = useNavigationReady();
  const firstScreenReady = useSplashStore((s) => s.firstScreenReady);
  const firstScreenSource = useSplashStore((s) => s.firstScreenSource);

  useEffect(() => {
    logSplash("bootstrap.state", {
      bootstrapReady,
      navigationReady,
      firstScreenReady,
      firstScreenSource,
    });
  }, [bootstrapReady, navigationReady, firstScreenReady, firstScreenSource]);

  useEffect(() => {
    if (!bootstrapReady || !navigationReady || !firstScreenReady) return;
    hideSplashOnce(
      firstScreenSource ? `first-screen:${firstScreenSource}` : "first-screen",
    );
  }, [bootstrapReady, navigationReady, firstScreenReady, firstScreenSource]);

  if (!bootstrapReady) {
    return null;
  }

  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authBrand.orange,
  },
});
