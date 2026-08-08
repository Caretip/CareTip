import type { Router } from "expo-router";
import {
  BarChart3,
  LineChart,
  QrCode,
  Settings,
  Trophy,
} from "@/icons/lucide";
import type { LucideIcon } from "@/types/lucide";

export type AppMenuItem = {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  onPress: () => void;
  badge?: number;
};

/**
 * More menu — secondary destinations only.
 * Primary daily tabs (Activity/Tips/Inbox/QR) live on MimeTabBar; Log out stays here.
 */
export function buildBusinessAppMenu(router: Router, _inboxBadge?: number): AppMenuItem[] {
  return [
    {
      id: "qr",
      labelKey: "tabs.qrStudio",
      icon: QrCode,
      onPress: () => router.push("/(app)/business/qr"),
    },
    {
      id: "analytics",
      labelKey: "businessDashboard.shortcuts.analytics",
      icon: BarChart3,
      onPress: () => router.push("/(app)/business/analytics"),
    },
    {
      id: "performance",
      labelKey: "businessDashboard.shortcuts.performance",
      icon: LineChart,
      onPress: () => router.push("/(app)/business/performance"),
    },
    {
      id: "leaderboard",
      labelKey: "businessDashboard.shortcuts.leaderboard",
      icon: Trophy,
      onPress: () => router.push("/(app)/business/leaderboard"),
    },
    {
      id: "settings",
      labelKey: "tabs.settings",
      icon: Settings,
      onPress: () => router.push("/(app)/business/settings"),
    },
  ];
}

export function buildEmployeeAppMenu(router: Router, _inboxBadge?: number): AppMenuItem[] {
  return [
    {
      id: "settings",
      labelKey: "tabs.settings",
      icon: Settings,
      onPress: () => router.push("/(app)/employee/settings"),
    },
  ];
}
