import { useEffect, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import { useBootstrapReady } from "@/hooks/useAppReady";
import { useNavigationReady } from "@/hooks/useNavigationReady";
import { colors } from "@/theme";
import { hideSplashOnce, logSplash } from "@/utils/splashLifecycle";

type NativeSplashGateProps = {
  children: ReactNode;
};

/**
 * Native splash only — hides once bootstrap (+ nav when available) or watchdog fires.
 * Does not wait for first-screen paint (Redirect chains never mounted anchors).
 */
export function NativeSplashGate({ children }: NativeSplashGateProps) {
  const bootstrapReady = useBootstrapReady();
  const navigationReady = useNavigationReady();

  useEffect(() => {
    logSplash("gate.state", { bootstrapReady, navigationReady });
  }, [bootstrapReady, navigationReady]);

  useEffect(() => {
    if (!bootstrapReady) return;
    hideSplashOnce("bootstrap-ready");
  }, [bootstrapReady]);

  useEffect(() => {
    if (!bootstrapReady || !navigationReady) return;
    hideSplashOnce("navigation-ready");
  }, [bootstrapReady, navigationReady]);

  if (!bootstrapReady) {
    return null;
  }

  return <View style={styles.root}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
