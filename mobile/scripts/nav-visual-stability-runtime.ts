/**
 * Navigation / visual-stability regressions (source-level).
 * Device flicker still requires a native build — this guards the confirmed causes.
 *
 *   npx tsx scripts/nav-visual-stability-runtime.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

function main(): void {
  const gate = read("components/brand/NativeSplashGate.tsx");
  assert.doesNotMatch(gate, /contentOpacity/);
  assert.doesNotMatch(gate, /COMPLETE_HOLD_MS/);
  assert.doesNotMatch(gate, /REVEAL_MS/);
  assert.doesNotMatch(gate, /js-overlay-ready/);
  assert.doesNotMatch(gate, /NATIVE_HANDOFF_DELAY/);
  assert.doesNotMatch(gate, /handoffNativeSplash/);
  assert.doesNotMatch(gate, /BrandSplashOverlay/);
  assert.doesNotMatch(gate, /overlayVisible/);
  assert.doesNotMatch(gate, /authBrand\.orange/);
  assert.match(gate, /hideSplashOnce\(reason, \{ duration: 0, fade: false \}\)/);
  assert.match(gate, /shouldRevealAfterDestination/);
  assert.match(gate, /firstScreenReady/);

  assert.equal(
    fs.existsSync(path.join(mobileRoot, "components/brand/BrandSplashOverlay.tsx")),
    false,
    "BrandSplashOverlay must be removed — native Expo splash only",
  );

  const rootNav = read("components/navigation/ThemedRootNavigation.tsx");
  assert.match(rootNav, /animation:\s*"none"/);
  assert.doesNotMatch(rootNav, /animationDuration:\s*220/);
  assert.doesNotMatch(rootNav, /authBrand\.orange/);
  assert.match(rootNav, /NativeSplashGate/);

  const appLayout = read("app/(app)/_layout.tsx");
  assert.match(appLayout, /animation:\s*"slide_from_right"/);
  assert.doesNotMatch(appLayout, /animation:\s*"fade"/);

  const authLayout = read("app/(auth)/_layout.tsx");
  assert.match(authLayout, /contentStyle: \{ backgroundColor: authBrand\.dark \}/);
  assert.match(authLayout, /animation:\s*"none"/);
  assert.doesNotMatch(authLayout, /backgroundColor: logoutTransition \? authBrand\.dark : "transparent"/);

  const tabs = read("theme/navigation.ts");
  assert.match(tabs, /animation:\s*"none"/);

  const businessDash = read("features/business/BusinessDashboardScreen.tsx");
  assert.doesNotMatch(businessDash, /FadeIn/);
  const employeeDash = read("features/employee/EmployeeDashboardScreen.tsx");
  assert.doesNotMatch(employeeDash, /FadeIn/);

  const login = read("features/auth/LoginScreen.tsx");
  assert.doesNotMatch(login, /isHydrated && isAuthenticated && user/);

  const appHome = read("app/(app)/index.tsx");
  assert.doesNotMatch(appHome, /return null/);

  const team = read("features/business/TeamManagementScreen.tsx");
  assert.match(team, /teamQuery\.isLoading && employees\.length === 0/);

  const lazy = read("components/navigation/LazyScreen.tsx");
  assert.match(lazy, /backgroundColor: colors\.background/);
  assert.doesNotMatch(lazy, /SkeletonListRows/);

  const timeframe = read("hooks/usePersistedTimeframe.ts");
  assert.match(timeframe, /timeframeMemory/);
  assert.match(timeframe, /timeframeMemory\.has\(storageKey\)/);

  const notifications = read("features/settings/sections/NotificationsSettingsSection.tsx");
  assert.doesNotMatch(notifications, /if \(!accountQuery\.data\) return null/);
  assert.doesNotMatch(notifications, /if \(!employeeQuery\.data\) return null/);
  assert.match(notifications, /accountQuery\.isLoading && !account/);

  const billingOverlay = read("components/billing/BillingReturnSyncOverlay.tsx");
  assert.match(billingOverlay, /animationType="none"/);

  const settingsBiz = read("app/(app)/business/settings/_layout.tsx");
  assert.match(settingsBiz, /animationDuration:\s*240/);
  const settingsEmp = read("app/(app)/employee/settings/_layout.tsx");
  assert.match(settingsEmp, /animationDuration:\s*240/);

  console.log("nav-visual-stability-runtime: OK");
}

main();
