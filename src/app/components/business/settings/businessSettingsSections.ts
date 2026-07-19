import type { CareIconName } from "@/components/icons";

export type BusinessSettingsSectionId =
  | "general"
  | "appearance"
  | "business"
  | "notifications"
  | "security"
  | "integrations";

export type BusinessSettingsSection = {
  id: BusinessSettingsSectionId;
  labelKey: string;
  descriptionKey: string;
  icon: CareIconName;
};

export const BUSINESS_SETTINGS_SECTIONS: readonly BusinessSettingsSection[] = [
  {
    id: "general",
    labelKey: "business.settings.sections.general",
    descriptionKey: "business.settings.sections.generalDesc",
    icon: "general",
  },
  {
    id: "appearance",
    labelKey: "business.settings.sections.preferences",
    descriptionKey: "business.settings.sections.preferencesDesc",
    icon: "settings",
  },
  {
    id: "business",
    labelKey: "business.settings.sections.business",
    descriptionKey: "business.settings.sections.businessDesc",
    icon: "hospitalityVenue",
  },
  {
    id: "notifications",
    labelKey: "business.settings.sections.notifications",
    descriptionKey: "business.settings.sections.notificationsDesc",
    icon: "notifications",
  },
  {
    id: "security",
    labelKey: "business.settings.sections.security",
    descriptionKey: "business.settings.sections.securityDesc",
    icon: "security",
  },
  {
    id: "integrations",
    labelKey: "business.settings.sections.integrations",
    descriptionKey: "business.settings.sections.integrationsDesc",
    icon: "support",
  },
] as const;

export const BUSINESS_SETTINGS_DEFAULT_SECTION: BusinessSettingsSectionId = "general";

const LEGACY_SECTION_REDIRECTS: Record<string, BusinessSettingsSectionId | "external"> = {
  profile: "business",
  account: "general",
  "profile-settings": "general",
  language: "appearance",
  preferences: "appearance",
  team: "external",
  billing: "external",
  branding: "external",
};

export function parseBusinessSettingsSection(raw: string | null): BusinessSettingsSectionId {
  if (!raw) return BUSINESS_SETTINGS_DEFAULT_SECTION;
  const mapped = LEGACY_SECTION_REDIRECTS[raw];
  if (mapped === "external") return BUSINESS_SETTINGS_DEFAULT_SECTION;
  if (mapped) return mapped;
  const valid = BUSINESS_SETTINGS_SECTIONS.some((s) => s.id === raw);
  if (valid) return raw as BusinessSettingsSectionId;
  return BUSINESS_SETTINGS_DEFAULT_SECTION;
}

export function legacySettingsSectionRedirectTarget(
  raw: string | null,
): "/dashboard/billing/subscription" | "/dashboard/qr-studio/branding" | "/dashboard/team/employees" | null {
  if (raw === "billing") return "/dashboard/billing/subscription";
  if (raw === "branding") return "/dashboard/qr-studio/branding";
  if (raw === "team") return "/dashboard/team/employees";
  return null;
}
