/**
 * Combined Locations / Tables management vs QR Studio display-only tables.
 * Run: npm run test:locations-tables-management
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlanLimitsForTier, hasFeature } from "../src/app/lib/subscriptionCapabilities";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(read(rel)) as Record<string, unknown>;
}

const basicLimits = getPlanLimitsForTier("basic");
const proLimits = getPlanLimitsForTier("premium");
if (basicLimits.maxLocations === 1 && basicLimits.maxTables === 1) {
  pass("Basic limits remain 1 location / 1 table");
} else {
  fail(`Basic limits drifted: ${JSON.stringify(basicLimits)}`);
}
if (proLimits.maxLocations == null && proLimits.maxTables == null) {
  pass("Pro locations and tables remain unlimited");
} else {
  fail("Pro venue limits drifted");
}
if (hasFeature("basic", "tableQr") && !hasFeature("basic", "multiLocation")) {
  pass("Basic keeps tableQr without multiLocation");
} else {
  fail("Basic tableQr / multiLocation matrix drifted");
}

const management = read("src/app/pages/business/LocationsPage.tsx");
const tablesPage = read("src/app/pages/business/TablesPage.tsx");
const studioTables = read("src/app/pages/business/qr-studio/QrStudioTablesPage.tsx");
const nav = read("src/app/components/business/businessDashboardNav.ts");
const routes = read("src/app/routes.tsx");
const en = readJson("src/i18n/locales/en.json") as {
  dashboardNav?: { business?: { locations?: string } };
  business?: {
    locationsPage?: Record<string, string>;
    qrStudio?: { tables?: Record<string, string> };
  };
};
const de = readJson("src/i18n/locales/de.json") as {
  dashboardNav?: { business?: { locations?: string } };
  business?: {
    locationsPage?: Record<string, string>;
    qrStudio?: { tables?: Record<string, string> };
  };
};

if (
  management.includes("createLocationAPI") &&
  management.includes("updateLocationAPI") &&
  management.includes("deleteLocationAPI") &&
  management.includes("createTableAPI") &&
  management.includes("tablesHeading") &&
  management.includes("openCreateTable")
) {
  pass("Combined page renders location CRUD and table creation");
} else {
  fail("Combined Locations / Tables page missing management handlers");
}

if (
  management.includes("createTableAPI({ name: trimmed, locationId })") &&
  management.includes("openCreateTable = (loc: LocationDTO)") &&
  management.includes("tableLocation")
) {
  pass("Table creation from a location uses that location id");
} else {
  fail("Contextual table create must send the section locationId");
}

if (!management.includes("updateTableAPI") && !management.includes("deleteTableAPI")) {
  pass("Table edit/delete remain unsupported (no invented APIs)");
} else {
  fail("Do not add table edit/delete without a backend contract");
}

if (
  management.includes("applyVenue") &&
  management.includes("writeVenueCatalog") &&
  management.includes('setPageSessionCache("business:locations"') &&
  management.includes('setPageSessionCache("business:tables-bundle"') &&
  management.includes("void load({ quiet: true })") &&
  !/await load\(\)/.test(management)
) {
  pass("Mutations write through venue catalog and session cache then quietly revalidate");
} else {
  fail("Combined page must not paint a stale 15-minute list after mutation");
}

if (management.includes("fetchVenueCatalog") && !management.includes("fetchLocationsCached")) {
  pass("Combined page loads locations and tables via the shared catalog");
} else {
  fail("Combined page should use fetchVenueCatalog, not a locations-only GET");
}

if (
  !management.includes('locCached ? { locations: locCached, tables: [] }') &&
  management.includes("row.locationId || row.location?.id") &&
  management.includes("overflow-visible")
) {
  pass("Locations page does not paint empty tables from a locations-only cache and groups by location id");
} else {
  fail("Locations page still hydrates empty tables or drops tables without locationId");
}

if (
  nav.includes('labelKey: "dashboardNav.business.locations"') &&
  nav.includes('href: "/dashboard/locations"') &&
  nav.includes("VENUE_MANAGEMENT_HREF") &&
  en.dashboardNav?.business?.locations === "Locations / Tables" &&
  de.dashboardNav?.business?.locations === "Standorte / Tische"
) {
  pass("Sidebar navigates to the combined page with a concise localized label");
} else {
  fail("Sidebar label or destination for Locations / Tables is wrong");
}

const sidebarShell = read("src/app/components/business/sidebar/BusinessSidebarNavShell.tsx");
const mobileSidebar = read("src/app/components/business/BusinessMobileSidebar.tsx");
if (
  sidebarShell.includes("businessSidebarNavEntries") &&
  mobileSidebar.includes("BusinessSidebarNavShell")
) {
  pass("Desktop and mobile navigation share the same sidebar entries");
} else {
  fail("Mobile/desktop sidebar no longer share businessSidebarNavEntries");
}

if (
  routes.includes('{ path: \'tables\', element: <Navigate to="/dashboard/locations" replace /> }') &&
  routes.includes("path: '/business/dashboard/tables'") &&
  routes.includes("path: '/business-dashboard/tables'") &&
  routes.includes("QrStudioTablesPage")
) {
  pass("Legacy /dashboard/tables redirects to Locations / Tables; QR Studio tables route remains");
} else {
  fail("Tables route redirects or QR Studio tables route missing");
}

if (studioTables.includes("<TablesPage embedded />")) {
  pass("QR Studio tables page still embeds the table QR display");
} else {
  fail("QR Studio tables wrapper lost TablesPage");
}

if (
  !tablesPage.includes("createTableAPI") &&
  !tablesPage.includes('t("business.tablesPage.create")') &&
  tablesPage.includes("renderPlainQrUrlToDataUrl") &&
  tablesPage.includes("qrTableUrl") &&
  tablesPage.includes("downloadQrDataUrlPng") &&
  tablesPage.includes("printQrDataUrl") &&
  tablesPage.includes("VENUE_MANAGEMENT_HREF") &&
  tablesPage.includes("business.qrStudio.tables.manageCta")
) {
  pass("QR Studio displays table QR codes and links out to manage tables");
} else {
  fail("QR Studio table display/create split is incomplete");
}

if (
  tablesPage.includes("BusinessResponsiveData") &&
  !tablesPage.includes('"overflow-hidden"')
) {
  pass("QR Studio table list does not clip the mobile card list with overflow-hidden");
} else {
  fail("BusinessResponsiveData still applies overflow-hidden over the table panel");
}

const responsive = read("src/app/components/business/BusinessResponsiveData.tsx");
if (responsive.includes("businessUi.mobileList") && !responsive.includes("overflow-hidden")) {
  pass("Mobile table cards are not clipped by overflow-hidden on the responsive panel");
} else {
  fail("BusinessResponsiveData still applies overflow-hidden over the mobile table list");
}

if (
  en.business?.locationsPage?.title === "Locations / Tables" &&
  de.business?.locationsPage?.title === "Standorte / Tische" &&
  en.business?.qrStudio?.tables?.manageCta &&
  de.business?.qrStudio?.tables?.manageCta &&
  en.business?.qrStudio?.tables?.emptyNoTables &&
  de.business?.qrStudio?.tables?.emptyNoTables
) {
  pass("English and German copy exist for the combined page and QR Studio empty state");
} else {
  fail("Missing EN/DE strings for Locations / Tables or QR Studio tables empty state");
}

const catalog = read("src/app/lib/businessVenueCatalog.ts");
if (catalog.includes("Promise.all([") && catalog.includes("fetchLocations()") && catalog.includes("fetchTables({ silent: true })")) {
  pass("Shared venue catalog still fetches locations and tables in parallel");
} else {
  fail("Venue catalog lost parallel fetch");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} locations-tables-management check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} locations-tables-management checks passed`);
