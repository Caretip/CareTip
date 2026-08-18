import { useEffect, useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authSocialLinks } from "@/constants/authLinks";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { openCareTipWeb } from "@/utils/openCareTipWeb";
import { authBrand } from "@/theme/authBrand";
import type { ColorPalette } from "@/theme/colors";
import { radius, spacing, touchTarget, typography } from "@/theme";

type AuthFooterSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Base path prefix for in-app info routes. */
  routePrefix?: "/(auth)" | "/(app)/info";
};

type FooterRow = {
  key: string;
  label: string;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  external?: boolean;
};

export function AuthFooterSheet({
  visible,
  onClose,
  routePrefix = "/(auth)",
}: AuthFooterSheetProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(48);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      opacity.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
      translateY.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
    } else {
      opacity.value = 0;
      translateY.value = 48;
    }
  }, [opacity, translateY, visible]);

  const backdropAnim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const sheetAnim = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const go = (path: string) => {
    onClose();
    const href =
      routePrefix === "/(auth)"
        ? (`/(auth)/${path}` as Href)
        : (`/(app)/info/${path}` as Href);
    setTimeout(() => router.push(href), 80);
  };

  const companyRows: FooterRow[] = [
    {
      key: "faq",
      label: t("auth.footerFaq"),
      icon: "help-circle-outline",
      onPress: () => go("faq"),
    },
    {
      key: "contact",
      label: t("auth.footerContact"),
      icon: "chatbubbles-outline",
      onPress: () => go("contact"),
    },
    {
      key: "about",
      label: t("auth.footerAbout"),
      icon: "heart-outline",
      onPress: () => go("about"),
    },
    {
      key: "privacy",
      label: t("auth.footerPrivacy"),
      icon: "shield-checkmark-outline",
      onPress: () => go("privacy"),
    },
    {
      key: "terms",
      label: t("auth.footerTerms"),
      icon: "document-text-outline",
      onPress: () => go("terms"),
    },
    {
      key: "impressum",
      label: t("auth.footerImpressum"),
      icon: "business-outline",
      onPress: () => go("impressum"),
    },
  ];

  const socialRows: FooterRow[] = [
    authSocialLinks.instagram
      ? {
          key: "instagram",
          label: t("auth.socialInstagram"),
          icon: "logo-instagram",
          external: true,
          onPress: () => void openCareTipWeb(authSocialLinks.instagram),
        }
      : null,
    authSocialLinks.facebook
      ? {
          key: "facebook",
          label: t("auth.socialFacebook"),
          icon: "logo-facebook",
          external: true,
          onPress: () => void openCareTipWeb(authSocialLinks.facebook),
        }
      : null,
    authSocialLinks.linkedin
      ? {
          key: "linkedin",
          label: t("auth.socialLinkedin"),
          icon: "logo-linkedin",
          external: true,
          onPress: () => void openCareTipWeb(authSocialLinks.linkedin),
        }
      : null,
    authSocialLinks.tiktok
      ? {
          key: "tiktok",
          label: t("auth.socialTiktok"),
          icon: "logo-tiktok",
          external: true,
          onPress: () => void openCareTipWeb(authSocialLinks.tiktok),
        }
      : null,
  ].filter((row): row is FooterRow => row != null);

  const renderRow = (row: FooterRow) => (
    <Pressable
      key={row.key}
      accessibilityRole="button"
      onPress={() => {
        if (row.external) onClose();
        row.onPress();
      }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={row.icon} size={20} color={authBrand.orange} />
      </View>
      <Text style={styles.rowLabel}>{row.label}</Text>
      <Ionicons
        name={row.external ? "open-outline" : "chevron-forward"}
        size={18}
        color={colors.mutedForeground}
      />
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropAnim]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel={t("common.cancel")}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            sheetAnim,
          ]}
        >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{t("auth.footerMenuTitle")}</Text>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <Text style={styles.sectionLabel}>{t("auth.footerCompanySection")}</Text>
            {companyRows.map(renderRow)}
            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>{t("auth.footerSocialSection")}</Text>
            {socialRows.length > 0 ? (
              <View style={styles.socialGrid}>
                {socialRows.map((row) => (
                  <Pressable
                    key={row.key}
                    accessibilityRole="button"
                    accessibilityLabel={row.label}
                    onPress={() => {
                      onClose();
                      row.onPress();
                    }}
                    style={({ pressed }) => [styles.socialChip, pressed ? styles.rowPressed : null]}
                  >
                    <Ionicons name={row.icon} size={20} color={authBrand.dark} />
                    <Text style={styles.socialLabel}>{row.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed ? styles.rowPressed : null]}
            >
              <Text style={styles.closeLabel}>{t("common.cancel")}</Text>
            </Pressable>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.md,
      maxHeight: "82%",
    },
    handle: {
      alignSelf: "center",
      width: 40,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.borderStrong,
      marginBottom: spacing.lg,
    },
    sheetTitle: {
      ...typography.h2,
      color: colors.foreground,
      marginBottom: spacing.lg,
    },
    sectionLabel: {
      ...typography.overline,
      color: colors.mutedForeground,
      marginBottom: spacing.sm,
    },
    row: {
      minHeight: touchTarget,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    rowPressed: { opacity: 0.72 },
    rowIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: "rgba(235, 153, 44, 0.12)",
      alignItems: "center",
      justifyContent: "center",
    },
    rowLabel: {
      ...typography.body,
      color: colors.foreground,
      flex: 1,
      fontWeight: "600",
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: spacing.lg,
    },
    socialGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    socialChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: touchTarget,
      paddingHorizontal: spacing.lg,
      borderRadius: 999,
      backgroundColor: colors.secondary,
    },
    socialLabel: {
      ...typography.caption,
      color: colors.foreground,
      fontWeight: "700",
    },
    closeBtn: {
      marginTop: spacing.xl,
      minHeight: touchTarget,
      alignItems: "center",
      justifyContent: "center",
    },
    closeLabel: {
      ...typography.button,
      color: authBrand.orange,
      fontWeight: "700",
    },
  });
}
