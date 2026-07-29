import type { LucideIcon } from "@/types/lucide";

export type SettingsMenuItem = {
  id: string;
  labelKey: string;
  descriptionKey?: string;
  icon: LucideIcon;
  onPress: () => void;
  destructive?: boolean;
};

export type SettingsMenuGroupConfig = {
  id: string;
  titleKey?: string;
  items: SettingsMenuItem[];
};

export type SettingsMenuConfig = {
  groups: SettingsMenuGroupConfig[];
};
