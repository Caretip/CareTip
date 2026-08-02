import { type ReactNode, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { notifyIdleTrustedActivity } from "@/lib/idleSession/idleSessionActivity";

type IdleActivityCaptureProps = {
  enabled: boolean;
  children: ReactNode;
};

/**
 * Captures trusted touch/pointer activity app-wide (touchstart / pointerdown equivalent).
 * Scroll and passive motion are intentionally excluded — matches web policy.
 */
export function IdleActivityCapture({ enabled, children }: IdleActivityCaptureProps) {
  const composed = useMemo(() => {
    const activityTap = Gesture.Tap()
      .runOnJS(true)
      .onBegin(() => {
        notifyIdleTrustedActivity();
      });
    return Gesture.Simultaneous(Gesture.Native(), activityTap);
  }, []);

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.root} collapsable={false}>
        {children}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
