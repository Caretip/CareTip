const path = require("path");

try {
  // Same env loading Expo uses for app.config.js (local .env / EAS).
  require("@expo/env").load(path.resolve(__dirname));
} catch {
  // Gradle or CI may already provide EXPO_PUBLIC_*.
}

const facebookNativeEnabled = Boolean(
  (process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "").trim() &&
    (process.env.EXPO_PUBLIC_FACEBOOK_CLIENT_TOKEN ?? "").trim(),
);

/**
 * Do not autolink react-native-fbsdk-next unless public Meta config exists.
 * facebook-android-sdk otherwise initializes at process start without an App ID
 * and kills the app after the splash (FacebookInitProvider).
 */
module.exports = {
  dependencies: facebookNativeEnabled
    ? {}
    : {
        "react-native-fbsdk-next": {
          platforms: {
            android: null,
            ios: null,
          },
        },
      },
};
