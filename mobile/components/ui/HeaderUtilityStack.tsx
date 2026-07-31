import { StyleSheet, View } from "react-native";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { spacing } from "@/theme";

type HeaderUtilityStackProps = {
  notificationsHref: string;
};

/** Dashboard header utilities — bell, theme, language (top-right stack). */
export function HeaderUtilityStack({ notificationsHref }: HeaderUtilityStackProps) {
  return (
    <View style={styles.stack}>
      <NotificationBell href={notificationsHref} variant="onHero" />
      <ThemeToggle variant="onHero" />
      <LanguageSwitcher variant="onHero" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.xxs,
  },
});
