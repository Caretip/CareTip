import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * Dynamic Expo config for EAS profiles.
 * - Cleartext HTTP allowed outside production (LAN beta / staging http edge cases).
 * - Production must use HTTPS API (enforced also in constants/config.ts).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development").toLowerCase();
  const isProduction = appEnv === "production" || appEnv === "prod";
  const allowCleartext = !isProduction;

  const base = config as ExpoConfig;
  const plugins = [...(base.plugins ?? [])].filter((plugin) => {
    if (plugin === "expo-build-properties") return false;
    if (Array.isArray(plugin) && plugin[0] === "expo-build-properties") return false;
    return true;
  });

  plugins.push([
    "expo-build-properties",
    {
      android: {
        usesCleartextTraffic: allowCleartext,
      },
    },
  ]);

  plugins.push("@react-native-google-signin/google-signin");

  return {
    ...base,
    name: base.name ?? "CareTip",
    slug: base.slug ?? "caretip-mobile",
    plugins,
    extra: {
      ...(base.extra ?? {}),
      appEnv: isProduction ? "production" : appEnv === "staging" || appEnv === "preview" || appEnv === "beta" ? "staging" : "development",
    },
  };
};
