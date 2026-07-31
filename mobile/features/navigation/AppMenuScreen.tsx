import { StyleSheet, View } from "react-native";
import LogOut from "lucide-react-native/icons/log-out";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SettingsMenuGroup, SettingsMenuRow } from "@/components/settings/SettingsMenuRow";
import { useI18n } from "@/hooks/useI18n";
import { useSignOutAction } from "@/hooks/useSignOutAction";
import { spacing } from "@/theme";
import type { AppMenuItem } from "@/features/navigation/appMenuConfig";

type AppMenuScreenProps = {
  role: "business" | "employee";
  items: AppMenuItem[];
};

export function AppMenuScreen({ role, items }: AppMenuScreenProps) {
  const { t } = useI18n();
  const onSignOut = useSignOutAction();

  return (
    <Screen tabSafe>
      <View style={styles.header}>
        <ScreenHeader
          eyebrow={t("appMenu.eyebrow")}
          title={t("appMenu.title")}
          subtitle={role === "business" ? t("appMenu.subtitleBusiness") : t("appMenu.subtitleEmployee")}
        />
      </View>
      <SettingsMenuGroup>
        {items.map((item, index) => (
          <SettingsMenuRow
            key={item.id}
            label={t(item.labelKey)}
            description={
              item.badge != null && item.badge > 0
                ? `${item.badge > 9 ? "9+" : item.badge} ${t("appMenu.unread")}`
                : undefined
            }
            icon={item.icon}
            onPress={item.onPress}
            showDivider={index < items.length - 1}
          />
        ))}
      </SettingsMenuGroup>

      <SettingsMenuGroup>
        <SettingsMenuRow
          label={t("settings.signOut")}
          icon={LogOut}
          onPress={onSignOut}
          destructive
          showDivider={false}
        />
      </SettingsMenuGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.md,
  },
});
