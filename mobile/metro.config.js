const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// lucide-react-native ships ESM (.mjs) icon modules; Metro must resolve them.
if (!config.resolver.sourceExts.includes("mjs")) {
  config.resolver.sourceExts.push("mjs");
}

config.resolver.unstable_enablePackageExports = true;

module.exports = config;
