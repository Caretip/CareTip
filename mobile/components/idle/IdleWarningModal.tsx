import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import type { IdleUiPhase } from "@/lib/idleSession/idleSessionStore";
import { radius, spacing, typography } from "@/theme";

export type IdleWarningModalProps = {
  open: boolean;
  phase: Exclude<IdleUiPhase, "none">;
  secondsRemaining: number;
  onStaySignedIn: () => void;
  onLogOut: () => void;
};

function shouldAnnounceCountdown(seconds: number, previous: number | null): boolean {
  if (previous === null) return true;
  if (seconds === 0) return true;
  if (seconds === 60 || seconds === 30 || seconds === 10) return true;
  return false;
}

export function IdleWarningModal({
  open,
  phase,
  secondsRemaining,
  onStaySignedIn,
  onLogOut,
}: IdleWarningModalProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const prevSeconds = useRef<number | null>(null);
  const [liveText, setLiveText] = useState("");

  const isUnsaved = phase === "unsaved-grace";
  const seconds = Math.max(0, Math.floor(secondsRemaining));

  useEffect(() => {
    if (!open) {
      prevSeconds.current = null;
      setLiveText("");
      return;
    }
    if (shouldAnnounceCountdown(seconds, prevSeconds.current)) {
      setLiveText(t("idleSession.countdownLive", { seconds }));
    }
    prevSeconds.current = seconds;
  }, [open, seconds, t]);

  const enter = Platform.OS === "android" ? undefined : FadeIn.duration(220);
  const exit = Platform.OS === "android" ? undefined : FadeOut.duration(160);

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      onRequestClose={onStaySignedIn}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <Animated.View entering={enter} exiting={exit} style={styles.backdrop}>
        <View style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <Animated.View entering={enter} exiting={exit} style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>
            {isUnsaved ? t("idleSession.unsavedTitle") : t("idleSession.warningTitle")}
          </Text>
          <Text style={styles.body}>
            {isUnsaved
              ? t("idleSession.unsavedBody", { seconds })
              : t("idleSession.warningBody")}
          </Text>

          <Text style={styles.countdown} accessibilityLiveRegion="polite" accessibilityLabel={liveText}>
            {seconds}s
          </Text>

          <View style={styles.actions}>
            <Button
              label={t("idleSession.staySignedIn")}
              onPress={onStaySignedIn}
              accessibilityLabel={t("idleSession.staySignedIn")}
            />
            <Button
              label={isUnsaved ? t("idleSession.logOutAnyway") : t("idleSession.logOutNow")}
              variant="outline"
              onPress={onLogOut}
              accessibilityLabel={isUnsaved ? t("idleSession.logOutAnyway") : t("idleSession.logOutNow")}
              labelStyle={styles.logoutLabel}
            />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing["2xl"],
    },
    card: {
      width: "100%",
      maxWidth: 400,
      backgroundColor: colors.cardElevated,
      borderRadius: radius["2xl"],
      paddingHorizontal: spacing["2xl"],
      paddingVertical: spacing["2xl"],
      gap: spacing.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...Platform.select({
        ios: {
          shadowColor: "#0B1220",
          shadowOpacity: 0.16,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
        },
        android: { elevation: 8 },
        default: {},
      }),
    },
    title: {
      ...typography.h2,
      color: colors.foreground,
      fontSize: 20,
      fontWeight: "700",
      letterSpacing: -0.3,
      textAlign: "center",
    },
    body: {
      ...typography.body,
      color: colors.mutedForeground,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
    },
    countdown: {
      fontSize: 32,
      lineHeight: 36,
      fontWeight: "800",
      color: colors.foreground,
      textAlign: "center",
      letterSpacing: -0.8,
      fontVariant: ["tabular-nums"],
    },
    actions: {
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    logoutLabel: {
      color: colors.destructive,
    },
  });
}
