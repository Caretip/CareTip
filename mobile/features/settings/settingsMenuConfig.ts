import { Alert } from "react-native";
import { useRouter, type Router } from "expo-router";
import Bell from "lucide-react-native/icons/bell";
import Building2 from "lucide-react-native/icons/building-2";
import CreditCard from "lucide-react-native/icons/credit-card";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import LifeBuoy from "lucide-react-native/icons/life-buoy";
import Info from "lucide-react-native/icons/info";
import Lock from "lucide-react-native/icons/lock";
import Palette from "lucide-react-native/icons/palette";
import Plug from "lucide-react-native/icons/plug";
import Shield from "lucide-react-native/icons/shield";
import User from "lucide-react-native/icons/user";
import Users from "lucide-react-native/icons/users";
import { openCareTipWeb } from "@/utils/openCareTipWeb";
import type { SettingsMenuConfig } from "@/features/settings/settingsMenuTypes";

export function buildBusinessSettingsMenu(router: Router): SettingsMenuConfig {
  const base = "/(app)/business/settings" as const;

  return {
    groups: [
      {
        id: "account",
        titleKey: "settings.menu.account",
        items: [
          {
            id: "general",
            labelKey: "settings.menu.general",
            descriptionKey: "settings.menu.generalDesc",
            icon: User,
            onPress: () => router.push(`${base}/general`),
          },
          {
            id: "appearance",
            labelKey: "settings.menu.appearance",
            descriptionKey: "settings.menu.appearanceDesc",
            icon: Palette,
            onPress: () => router.push(`${base}/appearance`),
          },
          {
            id: "business",
            labelKey: "settings.menu.businessProfile",
            descriptionKey: "settings.menu.businessProfileDesc",
            icon: Building2,
            onPress: () => router.push(`${base}/business-profile`),
          },
        ],
      },
      {
        id: "security-prefs",
        titleKey: "settings.menu.securityPrefs",
        items: [
          {
            id: "notifications",
            labelKey: "settings.menu.notifications",
            descriptionKey: "settings.menu.notificationsDesc",
            icon: Bell,
            onPress: () => router.push(`${base}/notifications`),
          },
          {
            id: "security",
            labelKey: "settings.menu.security",
            descriptionKey: "settings.menu.securityDesc",
            icon: Shield,
            onPress: () => router.push(`${base}/security`),
          },
          {
            id: "integrations",
            labelKey: "settings.menu.integrations",
            descriptionKey: "settings.menu.integrationsDesc",
            icon: Plug,
            onPress: () => router.push(`${base}/integrations`),
          },
        ],
      },
      {
        id: "business-mgmt",
        titleKey: "settings.menu.businessMgmt",
        items: [
          {
            id: "billing",
            labelKey: "settings.menu.billing",
            descriptionKey: "settings.menu.billingDesc",
            icon: CreditCard,
            onPress: () => void openCareTipWeb("/dashboard/billing/subscription"),
          },
          {
            id: "team",
            labelKey: "settings.menu.team",
            descriptionKey: "settings.menu.teamDesc",
            icon: Users,
            onPress: () => router.push("/(app)/business/team"),
          },
        ],
      },
      {
        id: "support-legal",
        titleKey: "settings.menu.supportLegal",
        items: [
          {
            id: "about",
            labelKey: "settings.menu.about",
            icon: Info,
            onPress: () => router.push("/(app)/info/about"),
          },
          {
            id: "contact",
            labelKey: "settings.menu.contact",
            icon: LifeBuoy,
            onPress: () => router.push("/(app)/info/contact"),
          },
          {
            id: "privacy",
            labelKey: "settings.privacy",
            icon: FileText,
            onPress: () => router.push("/(app)/info/privacy"),
          },
          {
            id: "terms",
            labelKey: "settings.terms",
            icon: Globe,
            onPress: () => router.push("/(app)/info/terms"),
          },
          {
            id: "faq",
            labelKey: "settings.menu.faq",
            icon: LifeBuoy,
            onPress: () => router.push("/(app)/info/faq"),
          },
          {
            id: "impressum",
            labelKey: "auth.footerImpressum",
            icon: FileText,
            onPress: () => router.push("/(app)/info/impressum"),
          },
        ],
      },
    ],
  };
}

export function buildEmployeeSettingsMenu(router: Router): SettingsMenuConfig {
  const base = "/(app)/employee/settings" as const;

  return {
    groups: [
      {
        id: "account",
        titleKey: "settings.menu.account",
        items: [
          {
            id: "profile",
            labelKey: "settings.menu.profile",
            descriptionKey: "settings.menu.profileDesc",
            icon: User,
            onPress: () => router.push(`${base}/profile`),
          },
          {
            id: "language",
            labelKey: "settings.menu.appearance",
            descriptionKey: "settings.menu.languageDesc",
            icon: Palette,
            onPress: () => router.push(`${base}/language`),
          },
        ],
      },
      {
        id: "security-prefs",
        titleKey: "settings.menu.securityPrefs",
        items: [
          {
            id: "notifications",
            labelKey: "settings.menu.notifications",
            descriptionKey: "settings.menu.notificationsDesc",
            icon: Bell,
            onPress: () => router.push(`${base}/notifications`),
          },
          {
            id: "security",
            labelKey: "settings.menu.security",
            descriptionKey: "settings.menu.securityDesc",
            icon: Lock,
            onPress: () => router.push(`${base}/security`),
          },
          {
            id: "privacy",
            labelKey: "settings.menu.privacyData",
            descriptionKey: "settings.menu.privacyDataDesc",
            icon: Shield,
            onPress: () => router.push(`${base}/privacy-data`),
          },
        ],
      },
      {
        id: "support-legal",
        titleKey: "settings.menu.supportLegal",
        items: [
          {
            id: "about",
            labelKey: "settings.menu.about",
            icon: Info,
            onPress: () => router.push("/(app)/info/about"),
          },
          {
            id: "contact",
            labelKey: "settings.menu.contact",
            icon: LifeBuoy,
            onPress: () => router.push("/(app)/info/contact"),
          },
          {
            id: "privacy",
            labelKey: "settings.privacy",
            icon: FileText,
            onPress: () => router.push("/(app)/info/privacy"),
          },
          {
            id: "terms",
            labelKey: "settings.terms",
            icon: Globe,
            onPress: () => router.push("/(app)/info/terms"),
          },
          {
            id: "faq",
            labelKey: "settings.menu.faq",
            icon: LifeBuoy,
            onPress: () => router.push("/(app)/info/faq"),
          },
          {
            id: "impressum",
            labelKey: "auth.footerImpressum",
            icon: FileText,
            onPress: () => router.push("/(app)/info/impressum"),
          },
        ],
      },
    ],
  };
}

export function confirmSignOut(t: (key: string) => string, onConfirm: () => void) {
  Alert.alert(t("settings.signOutConfirmTitle"), t("settings.signOutConfirmBody"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("settings.signOut"), style: "destructive", onPress: onConfirm },
  ]);
}
