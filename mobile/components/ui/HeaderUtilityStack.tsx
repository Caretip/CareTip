import { StyleSheet, View } from "react-native";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { spacing } from "@/theme";

type HeaderUtilityStackProps = {
  notificationsHref: string;
};

/** Dashboard header utilities — compact frosted-glass row (top-right). */
export function HeaderUtilityStack({ notificationsHref }: HeaderUtilityStackProps) {
  return (
    <View style={styles.row}>
      <NotificationBell href={notificationsHref} variant="onDashboardHero" />
      <ThemeToggle variant="onDashboardHero" />
      <LanguageSwitcher variant="onDashboardHero" />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.xxs,
  },
});
