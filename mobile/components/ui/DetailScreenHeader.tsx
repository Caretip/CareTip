import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "@/hooks/useI18n";
import { colors, hitSlop, spacing, touchTarget, typography } from "@/theme";

type DetailScreenHeaderProps = {
  title: string;
  subtitle?: string;
  /** Fallback when stack has no back history (e.g. hidden tab routes). */
  fallbackHref?: Href;
};

/** Back affordance for stack screens without native headers. */
export function DetailScreenHeader({ title, subtitle, fallbackHref }: DetailScreenHeaderProps) {
  const router = useRouter();
  const { t } = useI18n();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    if (fallbackHref) {
      router.replace(fallbackHref);
    }
  };

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        onPress={handleBack}
        style={styles.back}
        hitSlop={hitSlop.sm}
      >
        <Ionicons
          name="chevron-back"
          size={24}
          color={colors.foreground}
          style={styles.backIcon}
        />
      </Pressable>
      <View style={styles.titleWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  back: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -spacing.sm,
  },
  backIcon: {
    ...Platform.select({
      ios: { marginTop: 1 },
      default: {},
    }),
  },
  titleWrap: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xxs,
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
    textAlign: "center",
  },
  subtitle: {
    ...typography.caption,
    color: colors.mutedForeground,
    textAlign: "center",
  },
  spacer: {
    width: touchTarget - spacing.sm,
  },
});
