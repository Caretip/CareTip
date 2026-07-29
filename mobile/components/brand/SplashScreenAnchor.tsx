import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useSplashStore } from "@/store/splashStore";

type SplashScreenAnchorProps = {
  /** Label used in splash timing logs (e.g. "auth", "Screen"). */
  source: string;
};

/**
 * Invisible layout probe — signals that the hosting screen has painted.
 * Place on entry screens only (auth shell, tab home Screen, etc.).
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
