import { useMemo } from "react";
import { useRouter } from "expo-router";
import { SettingsMenuScreen } from "@/features/settings/SettingsMenuScreen";
import { buildBusinessSettingsMenu } from "@/features/settings/settingsMenuConfig";

export default function BusinessSettingsIndexRoute() {
  const router = useRouter();
  const config = useMemo(() => buildBusinessSettingsMenu(router), [router]);

  return <SettingsMenuScreen role="business" config={config} />;
}
