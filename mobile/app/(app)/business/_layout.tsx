import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PremiumTabBar } from "@/components/navigation/PremiumTabBar";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { buildPremiumTabScreenOptions } from "@/theme/navigation";

function TabIcon({
  outline,
  filled,
  color,
  size,
  focused,
}: {
  outline: keyof typeof Ionicons.glyphMap;
  filled: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
  focused: boolean;
}) {
  return <Ionicons name={focused ? filled : outline} size={size} color={color} />;
}

export default function BusinessTabsLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, isAuthenticated } = useAuth();
  const { data: unreadCount } = useUnreadNotificationCount(isAuthenticated);

  if (user?.role === "EMPLOYEE") {
    return <Redirect href="/(app)/employee" />;
  }
  if (user?.role === "SUPER_ADMIN") {
    return <Redirect href="/(app)/admin" />;
  }

  const inboxBadge = unreadCount && unreadCount > 0 ? unreadCount : undefined;

  return (
    <Tabs
      tabBar={(props) => <PremiumTabBar {...props} />}
      screenOptions={buildPremiumTabScreenOptions(insets.bottom)}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.dashboard"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              outline="grid-outline"
              filled="grid"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: t("tabs.activity"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              outline="pulse-outline"
              filled="pulse"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: t("tabs.qrStudio"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              outline="qr-code-outline"
              filled="qr-code"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="tips"
        options={{
          title: t("tabs.tips"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              outline="wallet-outline"
              filled="wallet"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t("tabs.inbox"),
          tabBarBadge: inboxBadge,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              outline="notifications-outline"
              filled="notifications"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t("tabs.settings"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              outline="settings-outline"
              filled="settings"
              color={color}
              size={size}
              focused={focused}
            />
          ),
        }}
      />
    </Tabs>
  );
}
