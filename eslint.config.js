import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import { fileURLToPath } from "node:url";
import path from "node:path";

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "scripts/**",
      "backend",
      // Expo app is a separate package; root ESLint targets the Vite web SPA only.
      "mobile/**",
      // Node tooling / pentest generators (not browser SPA source).
      "security/**",
      "docs/**",
      "e2e/**",
      "playwright.config.ts",
      "eslint.config.js",
      "src/imports/pasted_text/**",
      "public/firebase-messaging-sw.js",
      "public/fcm-sw-handler.js",
      "public/theme-init.js",
      "public/boot-locale.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "unused-imports": unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: [
      "src/app/pages/business/tips/BusinessActivityCenterPage.tsx",
      "src/app/hooks/useActivityCenterFeed.ts",
      "src/app/components/business/insights/ActivityCenterFeed.tsx",
      "src/app/lib/realtime/subscribeActivityCreated.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/app/hooks/useBusinessTipsModuleData",
              message:
                "Activity Center must not use tip-module analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "../../../hooks/useBusinessTipsModuleData",
              message:
                "Activity Center must not use tip-module analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "../../hooks/useBusinessTipsModuleData",
              message:
                "Activity Center must not use tip-module analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "../hooks/useBusinessTipsModuleData",
              message:
                "Activity Center must not use tip-module analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "./useBusinessTipsModuleData",
              message:
                "Activity Center must not use tip-module analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "@/app/hooks/useBusinessAnalytics",
              message:
                "Activity Center must not depend on analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "../../../hooks/useBusinessAnalytics",
              message:
                "Activity Center must not depend on analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "../../hooks/useBusinessAnalytics",
              message:
                "Activity Center must not depend on analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "../hooks/useBusinessAnalytics",
              message:
                "Activity Center must not depend on analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "./useBusinessAnalytics",
              message:
                "Activity Center must not depend on analytics. See docs/ARCHITECTURE_ACTIVITY_CENTER.md",
            },
            {
              name: "@/app/hooks/useLiveActivityStream",
              message: "useLiveActivityStream was removed; Activity Center uses activity.created only.",
            },
            {
              name: "../../../hooks/useLiveActivityStream",
              message: "useLiveActivityStream was removed; Activity Center uses activity.created only.",
            },
            {
              name: "../../hooks/useLiveActivityStream",
              message: "useLiveActivityStream was removed; Activity Center uses activity.created only.",
            },
            {
              name: "../hooks/useLiveActivityStream",
              message: "useLiveActivityStream was removed; Activity Center uses activity.created only.",
            },
            {
              name: "./useLiveActivityStream",
              message: "useLiveActivityStream was removed; Activity Center uses activity.created only.",
            },
            {
              name: "@/app/lib/realtime/subscribeTipReceived",
              message:
                "Activity Center must not subscribe to tip.received. Use subscribeActivityCreated.",
            },
            {
              name: "../../lib/realtime/subscribeTipReceived",
              message:
                "Activity Center must not subscribe to tip.received. Use subscribeActivityCreated.",
            },
            {
              name: "../lib/realtime/subscribeTipReceived",
              message:
                "Activity Center must not subscribe to tip.received. Use subscribeActivityCreated.",
            },
            {
              name: "./subscribeTipReceived",
              message:
                "Activity Center must not subscribe to tip.received. Use subscribeActivityCreated.",
            },
          ],
          patterns: [
            {
              group: ["**/useLiveActivityStream*", "**/LiveTipFeed*", "**/ActivityTimeline*", "**/TipsOverviewMetricCards*"],
              message:
                "Legacy Live Tips modules are removed. Activity Center uses BusinessActivityEvent only.",
            },
          ],
        },
      ],
    },
  }
);
