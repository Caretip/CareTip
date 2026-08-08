import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useSplashStore } from "@/store/splashStore";

type SplashScreenAnchorProps = {
  /**
   * Label used in splash timing logs.
   * Must identify a real destination (e.g. "auth", "LayeredScreen", "Screen").
   * Never use "index" / boot placeholders — those are rejected by policy.
   */
  source: string;
};

/**
 * Invisible layout probe — signals that the hosting destination screen has painted.
 * Place on AuthExperienceShell, LayeredScreen (dashboard), Screen — not app/index boot.
 */
export function SplashScreenAnchor({ source }: SplashScreenAnchorProps) {
  const markFirstScreenReady = useSplashStore((s) => s.markFirstScreenReady);

  const onLayout = useCallback(() => {
    markFirstScreenReady(source);
  }, [markFirstScreenReady, source]);

  return (
    <View
      style={styles.probe}
      pointerEvents="none"
      collapsable={false}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  probe: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
  },
});
