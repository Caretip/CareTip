/** @typedef {import('expo/config').ExpoConfig} ExpoConfig */
/** @typedef {import('expo/config').ConfigContext} ConfigContext */

/** @typedef {string | [string, ...unknown[]]} PluginEntry */

/**
 * @param {PluginEntry[] | undefined} plugins
 * @param {string} name
 * @returns {Record<string, unknown> | undefined}
 */
function findPluginConfig(plugins, name) {
  if (!plugins) return undefined;
  for (const plugin of plugins) {
    if (Array.isArray(plugin) && plugin[0] === name) {
      return /** @type {Record<string, unknown> | undefined} */ (plugin[1]) ?? {};
    }
  }
  return undefined;
}

/** @param {ExpoConfig} base */
function resolveEasProjectId(base) {
  const fromEnv = (process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "").trim();
  if (fromEnv) return fromEnv;
  const extra = /** @type {{ eas?: { projectId?: string } } | undefined} */ (base.extra);
  return extra?.eas?.projectId?.trim() || undefined;
}

/** Reversed iOS client ID for Google Sign-In URL scheme (com.googleusercontent.apps.*). */
function resolveGoogleIosUrlScheme() {
  const explicit = (process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? "").trim();
  if (explicit) return explicit;

  const iosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "").trim();
  if (!iosClientId) return undefined;

  const match = iosClientId.match(/^(.+)\.apps\.googleusercontent\.com$/);
  if (!match?.[1]) return undefined;
  return `com.googleusercontent.apps.${match[1]}`;
}

/**
 * Bare/prebuild workflow requires a fixed runtimeVersion string — not a policy object.
 * @param {ExpoConfig} base
 */
function resolveRuntimeVersion(base) {
  const runtimeVersion = base.runtimeVersion;
  if (typeof runtimeVersion === "string" && runtimeVersion.trim()) {
    return runtimeVersion.trim();
  }
  return base.version ?? "1.0.0";
}

/**
 * Dynamic Expo config for EAS profiles.
 * Uses .js (not .ts) so EAS CLI can load config without a TypeScript compiler.
 * iOS native projects are generated in EAS Build cloud — no local ios/ folder required.
 *
 * @param {ConfigContext} param0
 * @returns {ExpoConfig}
 */
module.exports = ({ config }) => {
  const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? "development").toLowerCase();
  const isProduction = appEnv === "production" || appEnv === "prod";
  const allowCleartext = !isProduction;

  const base = /** @type {ExpoConfig} */ (config);
  const basePlugins = /** @type {PluginEntry[]} */ (base.plugins ?? []);
  const existingBuildProps = findPluginConfig(basePlugins, "expo-build-properties") ?? {};

  const plugins = basePlugins.filter((plugin) => {
    if (plugin === "expo-build-properties") return false;
    if (Array.isArray(plugin) && plugin[0] === "expo-build-properties") return false;
    if (plugin === "@react-native-google-signin/google-signin") return false;
    if (Array.isArray(plugin) && plugin[0] === "@react-native-google-signin/google-signin") {
      return false;
    }
    return true;
  });

  plugins.push([
    "expo-build-properties",
    {
      android: {
        ...(/** @type {Record<string, unknown> | undefined} */ (existingBuildProps.android)),
        usesCleartextTraffic: allowCleartext,
      },
      ios: {
        ...(/** @type {Record<string, unknown> | undefined} */ (existingBuildProps.ios)),
        jsEngine: "hermes",
      },
    },
  ]);

  const googleIosUrlScheme = resolveGoogleIosUrlScheme();
  if (googleIosUrlScheme) {
    plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme: googleIosUrlScheme }]);
  } else {
    plugins.push("@react-native-google-signin/google-signin");
  }

  const easProjectId = resolveEasProjectId(base);
  const runtimeVersion = resolveRuntimeVersion(base);
  const baseIos = /** @type {Record<string, unknown>} */ (base.ios ?? {});
  const baseInfoPlist = /** @type {Record<string, unknown>} */ (baseIos.infoPlist ?? {});

  const iosInfoPlist = allowCleartext
    ? {
        ...baseInfoPlist,
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSAllowsLocalNetworking: true,
        },
      }
    : baseInfoPlist;

  return {
    ...base,
    name: base.name ?? "CareTip",
    slug: base.slug ?? "caretip-mobile",
    runtimeVersion,
    plugins,
    ios: {
      ...baseIos,
      bundleIdentifier: /** @type {string | undefined} */ (baseIos.bundleIdentifier) ?? "de.caretip.app",
      infoPlist: iosInfoPlist,
    },
    updates: easProjectId
      ? {
          url: `https://u.expo.dev/${easProjectId}`,
          checkAutomatically: "ON_LOAD",
          fallbackToCacheTimeout: 0,
        }
      : base.updates,
    extra: {
      ...(base.extra ?? {}),
      eas: {
        ...(/** @type {{ eas?: Record<string, unknown> } | undefined} */ (base.extra)?.eas ?? {}),
        ...(easProjectId ? { projectId: easProjectId } : {}),
      },
      appEnv: isProduction
        ? "production"
        : appEnv === "staging" || appEnv === "preview" || appEnv === "beta"
          ? "staging"
          : "development",
    },
  };
};
