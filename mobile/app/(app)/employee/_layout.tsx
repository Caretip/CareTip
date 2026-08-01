import { useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MimeTabBar } from "@/components/navigation/MimeTabBar";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/hooks/useI18n";
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
  const { user } = useAuth();

  if (user?.role === "MANAGER") {
    return <Redirect href="/(app)/business" />;
  }
  if (user?.role === "SUPER_ADMIN") {
    return <Redirect href="/(app)/admin" />;
  }

  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => <MimeTabBar {...props} />,
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
        name="menu"
        options={{
          title: t("tabs.more"),
          tabBarIcon: ({ color, size }) => <TabIcon name="menu" color={color} size={size} />,
        }}
      />
      <Tabs.Screen name="qr" options={{ href: null }} />
      <Tabs.Screen name="tips" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
    </Tabs>
  );
}
