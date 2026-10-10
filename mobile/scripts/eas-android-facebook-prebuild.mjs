/**
 * EAS Build keeps the committed android/ directory and does not run Expo prebuild.
 * The Facebook config plugin therefore never reaches the manifest.
 *
 * This hook applies only that plugin during an Android EAS build, after the public
 * App ID and Client Token are present in the environment. It does not print those
 * values, and it does not change the application id.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileModsAsync } from "@expo/config-plugins";

const require = createRequire(import.meta.url);
const pluginModule = require("react-native-fbsdk-next/app.plugin.js");
const withFacebook = pluginModule.default ?? pluginModule;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function publicFacebookConfig() {
  return {
    appId: (process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "").trim(),
    clientToken: (process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN ?? "").trim(),
  };
}

export async function applyFacebookAndroidConfig({ root, introspect }) {
  const { appId, clientToken } = publicFacebookConfig();
  if (!appId || !clientToken) {
    return { applied: false, reason: "missing-public-config" };
  }

  let config = {
    name: "CareTip",
    slug: "caretip-mobile",
    android: { package: "de.caretip.app" },
  };
  config = withFacebook(config, {
    appID: appId,
    clientToken,
    displayName: "CareTip",
    scheme: `fb${appId}`,
    advertiserIDCollectionEnabled: false,
    autoLogAppEventsEnabled: false,
    isAutoInitEnabled: false,
  });

  const compiled = await compileModsAsync(config, {
    projectRoot: root,
    platforms: ["android"],
    introspect,
  });
  return { applied: true, compiled };
}

async function main() {
  if ((process.env.EAS_BUILD ?? "") !== "true") return;
  if ((process.env.EAS_BUILD_PLATFORM ?? "").trim() !== "android") return;

  const result = await applyFacebookAndroidConfig({
    root: projectRoot,
    introspect: false,
  });
  if (!result.applied) {
    console.log(
      "eas-android-facebook-prebuild: public Facebook config is absent; committed Android project left unchanged.",
    );
    return;
  }
  console.log(
    "eas-android-facebook-prebuild: Facebook Login activities and client-token metadata applied for de.caretip.app.",
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error("eas-android-facebook-prebuild: failed");
    console.error(error instanceof Error ? error.message : "unknown error");
    process.exit(1);
  });
}
