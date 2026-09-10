import type { Router } from "expo-router";
import { EMPLOYEE_PAYOUTS_HREF } from "@/features/navigation/employeeRoutes";
import {
  BarChart3,
  LineChart,
  MapPin,
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
      id: "assignment",
      labelKey: "employeeAssignment.title",
      icon: MapPin,
      onPress: () => router.push("/(app)/employee/assignment"),
    },
    {
      id: "payouts",
      labelKey: "employeePayouts.title",
      icon: Wallet,
      onPress: () => router.push(EMPLOYEE_PAYOUTS_HREF),
    },
    {
      id: "settings",
      labelKey: "tabs.settings",
      icon: Settings,
      onPress: () => router.push("/(app)/employee/settings"),
    },
  ];
}
