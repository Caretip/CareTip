import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authSocialLinks, authWebPaths } from "@/constants/authLinks";
import { useI18n } from "@/hooks/useI18n";
import { openCareTipWeb } from "@/utils/openCareTipWeb";
import { colors, radius, spacing, touchTarget, typography } from "@/theme";

type AuthFooterSheetProps = {
  visible: boolean;
  onClose: () => void;
};

type FooterRow = {
  key: string;
  label: string;
  onPress: () => void;
  icon: keyof typeof Ionicons.glyphMap;
  external?: boolean;
};

export function AuthFooterSheet({ visible, onClose }: AuthFooterSheetProps) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  const companyRows: FooterRow[] = [
    {
      key: "about",
      label: t("auth.footerAbout"),
      icon: "business-outline",
      onPress: () => void openCareTipWeb(authWebPaths.about),
    },
    {
      key: "contact",
      label: t("auth.footerContact"),
      icon: "mail-outline",
      onPress: () => void openCareTipWeb(authWebPaths.contact),
    },
    {
      key: "faq",
      label: t("auth.footerFaq"),
      icon: "help-circle-outline",
      onPress: () => void openCareTipWeb(authWebPaths.faq),
    },
    {
      key: "privacy",
      label: t("auth.footerPrivacy"),
      icon: "shield-checkmark-outline",
      onPress: () => void openCareTipWeb(authWebPaths.privacy),
    },
    {
      key: "terms",
      label: t("auth.footerTerms"),
      icon: "document-text-outline",
      onPress: () => void openCareTipWeb(authWebPaths.terms),
    },
  ];

  const socialRows: FooterRow[] = [
    {
      key: "facebook",
      label: t("auth.socialFacebook"),
      icon: "logo-facebook",
      external: true,
      onPress: () => void openCareTipWeb(authSocialLinks.facebook),
    },
    {
      key: "instagram",
      label: t("auth.socialInstagram"),
      icon: "logo-instagram",
      external: true,
      onPress: () => void openCareTipWeb(authSocialLinks.instagram),
    },
    {
      key: "linkedin",
      label: t("auth.socialLinkedin"),
      icon: "logo-linkedin",
      external: true,
      onPress: () => void openCareTipWeb(authSocialLinks.linkedin),
    },
    {
      key: "x",
      label: t("auth.socialX"),
      icon: "logo-twitter",
      external: true,
      onPress: () => void openCareTipWeb(authSocialLinks.x),
    },
  ];

  const renderRow = (row: FooterRow) => (
    <Pressable
      key={row.key}
      accessibilityRole="button"
      onPress={() => {
        onClose();
        row.onPress();
      }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={row.icon} size={20} color={colors.foreground} />
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
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("common.cancel")} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>{t("auth.footerMenuTitle")}</Text>
        <Text style={styles.sectionLabel}>{t("auth.footerCompanySection")}</Text>
        {companyRows.map(renderRow)}
        <View style={styles.divider} />
        <Text style={styles.sectionLabel}>{t("auth.footerSocialSection")}</Text>
        {socialRows.map(renderRow)}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.closeBtn, pressed ? styles.rowPressed : null]}
        >
          <Text style={styles.closeLabel}>{t("common.cancel")}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
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
  rowPressed: {
    opacity: 0.72,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    backgroundColor: colors.secondary,
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
  closeBtn: {
    marginTop: spacing.lg,
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  closeLabel: {
    ...typography.button,
    color: colors.primary,
    fontWeight: "700",
  },
});
