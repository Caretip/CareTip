import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { colors } from "@/theme";
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

export default function EmployeeTabsLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { user, isAuthenticated } = useAuth();
  const { data: unreadCount } = useUnreadNotificationCount(isAuthenticated);

  if (user?.role === "MANAGER") {
    return <Redirect href="/(app)/business" />;
  }
  if (user?.role === "SUPER_ADMIN") {
    return <Redirect href="/(app)/admin" />;
  }

  const inboxBadge = unreadCount && unreadCount > 0 ? unreadCount : undefined;

  return (
    <Tabs
      screenOptions={{
        ...buildPremiumTabScreenOptions(insets.bottom),
        tabBarBadgeStyle: {
          backgroundColor: colors.primary,
          color: colors.primaryForeground,
          fontSize: 10,
          fontWeight: "700",
          minWidth: 18,
          height: 18,
          lineHeight: 16,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.overview"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon
              outline="home-outline"
              filled="home"
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
          title: t("tabs.myQr"),
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
          title: t("tabs.tipHistory"),
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
