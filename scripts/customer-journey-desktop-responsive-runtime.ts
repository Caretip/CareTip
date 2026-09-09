/**
 * Customer journey desktop canvas constraints (no browser).
 *
 *   npm run test:customer-journey-desktop-responsive
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function run() {
  const css = read("src/styles/caretip-customer-flow-premium.css");
  const ui = read("src/app/pages/customer/customerFlowUi.ts");
  const picker = read("src/app/pages/customer/CustomerTeamPicker.tsx");
  const shell = read("src/app/pages/customer/CustomerFlowShell.tsx");
  const globals = read("src/styles/globals.css");

  assert.match(globals, /max-width:\s*80rem/, "global caretip-container stays dashboard-scale");
  assert.match(css, /--customer-flow-canvas:\s*36rem/);
  assert.match(css, /\.customer-flow--team/);
  assert.match(css, /--customer-flow-canvas:\s*42rem/);
  assert.match(css, /\.customer-flow--compact/);
  assert.match(css, /--customer-flow-canvas:\s*28rem/);
  assert.match(css, /\.customer-flow-frame \{/);
  assert.match(css, /max-width:\s*var\(--customer-flow-canvas\)/);
  assert.match(ui, /frame: "customer-flow-frame w-full"/);
  assert.match(shell, /cf\.frame/);
  assert.doesNotMatch(
    css,
    /\.customer-flow \.customer-journey-header \{\s*max-width:\s*100%;/,
    "header must not force 100% of the 80rem container",
  );

  assert.match(ui, /pageTeam: "customer-flow customer-flow--team/);
  assert.match(ui, /pageCompact: "customer-flow customer-flow--compact/);
  assert.match(ui, /mainTeam:[\s\S]*max-w-2xl/);
  assert.doesNotMatch(ui, /mainTeam:[\s\S]*max-w-4xl/);
  assert.match(ui, /customer-flow-canvas--compact/);
  assert.match(ui, /customerJourneyAttributionFooter:\s*\n?\s*"mx-auto w-full pb-8 pt-1 sm:pb-10"/);

  assert.doesNotMatch(picker, /lg:gap-x-8/);
  assert.match(picker, /variant="square"/);
  assert.match(picker, /employeeGridPhoto/);

  assert.match(shell, /customer-flow-canvas--compact/);
  assert.match(shell, /pageCompact/);

  const teamPages = [
    "src/app/pages/customer/QRLandingPage.tsx",
    "src/app/pages/customer/LocationQrLandingPage.tsx",
    "src/app/pages/customer/TableQrLandingPage.tsx",
    "src/app/pages/customer/BusinessStaffDirectoryPage.tsx",
  ];
  for (const rel of teamPages) {
    const src = read(rel);
    assert.match(src, /cf\.pageTeam/, `${rel} must use the team canvas`);
    assert.match(src, /cf\.frame/, `${rel} must wrap in customer-flow-frame`);
  }

  const success = read("src/app/pages/customer/TipSuccessExperience.tsx");
  assert.match(success, /customer-flow--compact/);
  assert.match(success, /max-w-md/);

  const landingLang = read("src/i18n/i18n.ts");
  assert.match(landingLang, /fallbackLng:\s*lng/);

  console.log("customer-journey-desktop-responsive-runtime: OK");
}

run();
