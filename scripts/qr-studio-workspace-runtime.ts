/**
 * QR Studio final workspace UI regression (static).
 * Run: npm run test:qr-studio-workspace
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(root);
const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function read(rel: string): string {
  return readFileSync(path.join(repo, rel), "utf8");
}

const css = read("src/styles/qr-studio-workspace.css");
if (css.includes("qr-studio-asset-card") && css.includes("qr-studio-action-link")) {
  pass("QR Studio workspace CSS defines asset cards and action hierarchy");
} else fail("qr-studio-workspace.css incomplete");

if (!css.includes("qr-studio-workspace-subnav")) {
  pass("Duplicate in-page subnav styles removed from workspace CSS");
} else fail("Remove deprecated subnav styles from qr-studio-workspace.css");

if (css.includes("qr-studio-asset-card__grid--management")) {
  pass("Main QR uses management grid (not poster layout)");
} else fail("Management grid CSS missing");

const dash = read("src/styles/bundles/dashboard.css");
if (dash.includes("qr-studio-workspace.css")) pass("Dashboard bundle imports QR Studio workspace CSS");
else fail("dashboard.css must import qr-studio-workspace.css");

const card = read("src/app/components/business/QrManagementCard.tsx");
if (card.includes("QrStudioAssetActions") && card.includes("qr-studio-asset-card--management")) {
  pass("QrManagementCard uses unified asset actions and management layout");
} else fail("QrManagementCard final refactor missing");

const layout = read("src/app/pages/business/qr-studio/QrStudioLayout.tsx");
if (!layout.includes("QrStudioWorkspaceSubnav") && layout.includes("QrStudioMobileSectionSelect")) {
  pass("QR Studio layout uses mobile section select only (no duplicate desktop subnav)");
} else fail("QrStudioLayout must drop workspace subnav and add mobile select");

const mgmt = read("src/app/pages/business/QRCodeManagementPage.tsx");
if (mgmt.includes("QrStudioPageShell") && mgmt.includes('layout="storefront"')) {
  pass("Embedded QR pages use page shell and storefront management card");
} else fail("QRCodeManagementPage page shell integration missing");

const tables = read("src/app/pages/business/TablesPage.tsx");
if (tables.includes("QrStudioTableWorkspaceCard") && tables.includes("QrStudioPageShell")) {
  pass("Table QR page uses page shell and workspace cards");
} else fail("TablesPage embedded workspace integration missing");

const actions = read("src/app/components/business/qr-studio/QrStudioAssetActions.tsx");
if (actions.includes("qr-studio-action-link") && actions.includes("qr-studio-action-controls")) {
  pass("Asset actions use PDF primary + text secondary links");
} else fail("QrStudioAssetActions hierarchy missing");

const plain = read("src/app/lib/plainQr.ts");
if (!card.includes("renderBrandedQrUrlToDataUrl")) pass("Digital QR card does not call branded renderer");
else fail("QrManagementCard must not use branded renderer");

const en = read("src/i18n/locales/en.json");
if (en.includes("moreActionsAria") && en.includes("storefrontPlacementHint")) {
  pass("EN i18n for QR Studio actions and hints");
} else fail("EN qrStudio strings missing");

const de = read("src/i18n/locales/de.json");
if (de.includes("moreActionsAria") && de.includes("storefrontPlacementHint")) {
  pass("DE i18n for QR Studio actions and hints");
} else fail("DE qrStudio strings missing");

const failed = results.filter((r) => r.startsWith("FAIL:"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nQR Studio workspace checks passed.");
