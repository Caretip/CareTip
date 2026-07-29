import { useMemo } from "react";
import { useRouter } from "expo-router";
import { SettingsMenuScreen } from "@/features/settings/SettingsMenuScreen";
import { buildEmployeeSettingsMenu } from "@/features/settings/settingsMenuConfig";

export default function EmployeeSettingsIndexRoute() {
  const router = useRouter();
  const config = useMemo(() => buildEmployeeSettingsMenu(router), [router]);

  return <SettingsMenuScreen role="employee" config={config} />;
}
