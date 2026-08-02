import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { HeaderIconButton, type HeaderControlVariant } from "@/components/ui/HeaderIconButton";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { brand, typography } from "@/theme";
import type { ColorPalette } from "@/theme/colors";

type NotificationBellProps = {
  href: string;
  variant?: HeaderControlVariant;
};

function formatBadge(count: number): string {
  if (count <= 0) return "";
  if (count > 9) return "9+";
  return String(count);
}

export function NotificationBell({ href, variant = "onHero" }: NotificationBellProps) {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors, variant), [colors, variant]);
  const { isAuthenticated } = useAuth();
  const { data: unread = 0 } = useUnreadNotificationCount(isAuthenticated);
  const badge = formatBadge(unread);

  return (
    <View style={styles.wrap}>
      <HeaderIconButton
        icon="notifications-outline"
        accessibilityLabel={
          unread > 0
            ? t("preferences.notificationsA11y", { count: unread > 9 ? "9+" : unread })
            : t("preferences.notifications")
        }
        onPress={() => router.push(href as never)}
        variant={variant}
      />
      {badge ? (
        <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.badgeLabel}>{badge}</Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ColorPalette, variant: HeaderControlVariant) {
  const isDashboardHero = variant === "onDashboardHero";
  const badgeBorder =
    variant === "onHero"
      ? "#FFFFFF"
      : isDashboardHero
        ? "transparent"
        : colors.background;

  return StyleSheet.create({
    wrap: {
      position: "relative",
    },
    badge: {
      position: "absolute",
      top: isDashboardHero ? 6 : -2,
      right: isDashboardHero ? 6 : -2,
      minWidth: isDashboardHero ? 14 : 18,
      height: isDashboardHero ? 14 : 18,
      borderRadius: isDashboardHero ? 7 : 9,
      backgroundColor: brand.orange,
      borderWidth: isDashboardHero ? 1.5 : 2,
      borderColor: badgeBorder,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: isDashboardHero ? 3 : 4,
    },
    badgeLabel: {
      ...typography.caption,
      color: colors.primaryForeground,
      fontSize: isDashboardHero ? 8 : 10,
      fontWeight: "800",
      lineHeight: isDashboardHero ? 10 : 12,
    },
  });
}
