import type { Router } from "expo-router";
import {
  Activity,
  BarChart3,
  Bell,
  LineChart,
  QrCode,
  Settings,
  Trophy,
  Wallet,
} from "@/icons/lucide";
import type { LucideIcon } from "@/types/lucide";

export type AppMenuItem = {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  onPress: () => void;
  badge?: number;
};

export function buildBusinessAppMenu(router: Router, inboxBadge?: number): AppMenuItem[] {
  return [
    {
      id: "activity",
      labelKey: "tabs.activity",
      icon: Activity,
      onPress: () => router.push("/(app)/business/activity"),
    },
    {
      id: "qr",
      labelKey: "tabs.qrStudio",
      icon: QrCode,
      onPress: () => router.push("/(app)/business/qr"),
    },
    {
      id: "tips",
      labelKey: "tabs.tips",
      icon: Wallet,
      onPress: () => router.push("/(app)/business/tips"),
    },
    {
      id: "inbox",
      labelKey: "tabs.inbox",
      icon: Bell,
      onPress: () => router.push("/(app)/business/notifications"),
      badge: inboxBadge,
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

export function buildEmployeeAppMenu(router: Router, inboxBadge?: number): AppMenuItem[] {
  return [
    {
      id: "qr",
      labelKey: "tabs.myQr",
      icon: QrCode,
      onPress: () => router.push("/(app)/employee/qr"),
    },
    {
      id: "tips",
      labelKey: "tabs.tipHistory",
      icon: Wallet,
      onPress: () => router.push("/(app)/employee/tips"),
    },
    {
      id: "inbox",
      labelKey: "tabs.inbox",
      icon: Bell,
      onPress: () => router.push("/(app)/employee/notifications"),
      badge: inboxBadge,
    },
    {
      id: "settings",
      labelKey: "tabs.settings",
      icon: Settings,
      onPress: () => router.push("/(app)/employee/settings"),
    },
  ];
}
