import { useMemo } from "react";
import {
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useBillingWebInfoStore } from "@/store/billingWebInfoStore";
import { getAppPublicBaseUrl } from "@/utils/appPublicUrl";
import { hapticLight } from "@/utils/haptics";
import { radius, spacing, typography } from "@/theme";

const WEBSITE_LABEL = "caretip.de";

/** Informational modal — opens caretip.de externally without authenticated handoff. */
export function BillingWebInfoModal() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const visible = useBillingWebInfoStore((s) => s.visible);
  const close = useBillingWebInfoStore((s) => s.close);

  const openWebsite = async () => {
    hapticLight();
    await Linking.openURL(getAppPublicBaseUrl());
  };

  const enter = Platform.OS === "android" ? undefined : FadeIn.duration(220);
  const exit = Platform.OS === "android" ? undefined : FadeOut.duration(160);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={close}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <Animated.View entering={enter} exiting={exit} style={styles.backdrop}>
        <Animated.View entering={enter} exiting={exit} style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{t("billingWebInfo.title")}</Text>

          <View style={styles.bodyBlock}>
            <Text style={styles.body}>{t("billingWebInfo.bodyIntro")}</Text>
            <Pressable
              onPress={() => void openWebsite()}
              accessibilityRole="link"
              accessibilityLabel={WEBSITE_LABEL}
              hitSlop={8}
            >
              <Text style={styles.link}>{WEBSITE_LABEL}</Text>
            </Pressable>
            <Text style={styles.body}>{t("billingWebInfo.bodyAfterLink")}</Text>
          </View>

          <Button label={t("billingWebInfo.dismiss")} onPress={close} />
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
    bodyBlock: {
      gap: spacing.sm,
    },
    body: {
      ...typography.body,
      color: colors.mutedForeground,
      fontSize: 15,
      lineHeight: 22,
      textAlign: "center",
    },
    link: {
      ...typography.body,
      color: colors.primary,
      fontSize: 15,
      lineHeight: 22,
      fontWeight: "700",
      textAlign: "center",
      textDecorationLine: "underline",
    },
  });
}
