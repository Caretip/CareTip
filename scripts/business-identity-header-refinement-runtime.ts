/**
 * Business identity header/sidebar polish regression.
 * Run: npm run test:business-identity-header-refinement
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const header = read("src/app/components/DashboardHeader.tsx");
assert(
  header.includes("caretip-dashboard-header-business-identity"),
  "DashboardHeader uses business identity link class",
);
assert(
  header.includes('businessLogoSettingsAria'),
  "DashboardHeader uses business-specific settings aria label",
);
assert(
  !header.includes("max-w-[2.75rem]"),
  "DashboardHeader must not clip business logo link on narrow viewports",
);
assert(header.includes('size="dashboardHeader"'), "DashboardHeader uses dashboardHeader logo bounds");
assert(header.includes('useBusinessVenueBrand'), "DashboardHeader loads venue brand via shared hook");

const sidebar = read("src/app/components/business/BusinessSidebar.tsx");
assert(sidebar.includes("CareTipLogo"), "BusinessSidebar keeps CareTip platform branding");
assert(!sidebar.includes("BusinessLogoMark"), "BusinessSidebar must not duplicate business logo");

const venueName = read("src/app/components/business/sidebar/BusinessSidebarSubscriptionStatus.tsx");
assert(venueName.includes("business-sidebar-venue-name"), "Sidebar venue name strip uses identity class");
assert(venueName.includes("user?.businessName"), "Sidebar business name from auth user");

const mobileDrawer = read("src/app/components/business/BusinessMobileSidebar.tsx");
assert(
  !mobileDrawer.includes("BusinessLogoMark"),
  "Mobile drawer stays text-only; logo remains in header",
);

const css = read("src/styles/business-dashboard-identity-header.css");
assert(
  css.includes(".caretip-dashboard-header-business-identity"),
  "Identity header CSS defines business mark container",
);
assert(css.includes("min-height"), "Identity container has stable min dimensions");

const bundle = read("src/styles/bundles/dashboard.css");
assert(
  bundle.includes("business-dashboard-identity-header.css"),
  "Dashboard bundle imports identity header CSS",
);

const logoMark = read("src/app/components/business/BusinessLogoMark.tsx");
assert(logoMark.includes("object-contain"), "Business logos preserve aspect ratio");
assert(logoMark.includes("onError"), "Broken logo URLs fall back to initials");

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
assert(en.includes("businessLogoSettingsAria"), "EN shell.header business logo aria");
assert(de.includes("businessLogoSettingsAria"), "DE shell.header business logo aria");

console.log("business-identity-header-refinement-runtime: ok");
