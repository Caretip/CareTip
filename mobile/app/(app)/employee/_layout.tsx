import { useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MimeTabBar } from "@/components/navigation/MimeTabBar";
import { EMPLOYEE_PRIMARY_TAB_ROUTES } from "@/features/navigation/primaryTabs";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import { useTheme } from "@/hooks/useTheme";
import { buildPremiumTabScreenOptions } from "@/theme/navigation";

function TabIcon({
  name,
  color,
  size,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  size: number;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function EmployeeTabsLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { colors } = useTheme();
  const { user, isAuthenticated } = useAuth();
  const { data: unreadCount } = useUnreadNotificationCount(isAuthenticated);
  const inboxBadge = unreadCount && unreadCount > 0 ? unreadCount : undefined;

  if (user?.role === "MANAGER") {
    return <Redirect href="/(app)/business" />;
  }
  if (user?.role === "SUPER_ADMIN") {
    return <Redirect href="/(app)/admin" />;
  }

  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => (
      <MimeTabBar {...props} primaryRoutes={EMPLOYEE_PRIMARY_TAB_ROUTES} />
    ),
    [],
  );

  return (
    <Tabs
      tabBar={renderTabBar}
      screenOptions={buildPremiumTabScreenOptions(insets.bottom, colors)}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tabs.home"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name={focused ? "home" : "home-outline"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="tips"
        options={{
          title: t("tabs.tipHistory"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name={focused ? "wallet" : "wallet-outline"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="qr"
        options={{
          title: t("tabs.myQr"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name={focused ? "qr-code" : "qr-code-outline"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t("tabs.inbox"),
          tabBarBadge: inboxBadge,
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name={focused ? "notifications" : "notifications-outline"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: t("tabs.more"),
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name={focused ? "menu" : "menu-outline"} color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="assignment" options={{ href: null }} />
    </Tabs>
  );
}
