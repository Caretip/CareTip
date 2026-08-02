import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useCookieConsent } from "@/hooks/useCookieConsent";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { brand, radius, shadows, spacing, typography } from "@/theme";
import { hapticLight } from "@/utils/haptics";

/** Compact inline cookie notice — sits below the dashboard summary block. */
export function DashboardCookieConsent() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const { bannerVisible, acceptAll, rejectNonEssential } = useCookieConsent();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!bannerVisible) return null;

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.row}>
        <Ionicons
          name="shield-checkmark-outline"
          size={18}
          color={brand.orange}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={styles.message} numberOfLines={2}>
          {t("cookieConsent.banner.message")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("cookieConsent.banner.acceptAll")}
          onPress={() => {
            hapticLight();
            void acceptAll();
          }}
          style={({ pressed }) => [styles.acceptButton, pressed ? styles.acceptPressed : null]}
        >
          <Text style={styles.acceptLabel}>{t("cookieConsent.banner.acceptAll")}</Text>
        </Pressable>
      </View>
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("cookieConsent.banner.privacyPolicy")}
          onPress={() => router.push("/(app)/info/privacy" as never)}
          hitSlop={8}
        >
          <Text style={styles.link}>{t("cookieConsent.banner.privacyPolicy")}</Text>
        </Pressable>
        <Text style={styles.dot} accessibilityElementsHidden>
          ·
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("cookieConsent.banner.reject")}
          onPress={() => {
            hapticLight();
            void rejectNonEssential();
          }}
          hitSlop={8}
        >
          <Text style={styles.linkMuted}>{t("cookieConsent.banner.reject")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      gap: spacing.xs,
      ...shadows.sm,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    message: {
      flex: 1,
      ...typography.caption,
      color: colors.foreground,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
    },
    acceptButton: {
      minHeight: 36,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    acceptPressed: {
      opacity: 0.88,
    },
    acceptLabel: {
      ...typography.caption,
      color: colors.primaryForeground,
      fontSize: 13,
      fontWeight: "700",
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingLeft: 26,
    },
    link: {
      ...typography.caption,
      color: brand.orange,
      fontSize: 12,
      fontWeight: "600",
    },
    linkMuted: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontSize: 12,
      fontWeight: "600",
    },
    dot: {
      ...typography.caption,
      color: colors.mutedForeground,
      fontSize: 12,
    },
  });
}
