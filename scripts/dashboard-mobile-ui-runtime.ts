/**
 * Dashboard mobile UI + global content cleanup regression.
 * Run: npm run test:dashboard-mobile-ui
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function read(rel: string): string {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function exists(rel: string): boolean {
  return existsSync(path.join(repoRoot, rel));
}

const sharedUi = read("src/app/components/dashboard/dashboardSharedUi.ts");
if (sharedUi.includes("mobileFlatSurface") && sharedUi.includes("mobileHideDesc")) {
  pass("dashboardSharedUi mobile flat/hide tokens present");
} else fail("dashboardSharedUi mobile tokens missing");

const mobileTheme = read("src/styles/caretip-dashboard-mobile-theme.css");
if (
  mobileTheme.includes("dashboard-mobile-flat-surface") &&
  mobileTheme.includes("dashboard-at-a-glance--mobile-flat")
) {
  pass("mobile theme flattening rules present");
} else fail("mobile theme flattening rules missing");

const globals = read("src/styles/globals.css");
if (globals.includes("employee-hero-cta-btn") && globals.includes("white-space: normal")) {
  pass("hero CTA allows wrapped labels on mobile");
} else fail("hero CTA mobile wrap fix missing");

const businessMobileSidebar = read("src/app/components/business/BusinessMobileSidebar.tsx");
if (
  !businessMobileSidebar.includes("BusinessLogoMark") &&
  businessMobileSidebar.includes("caretip-mobile-drawer-workspace__identity--text-only")
) {
  pass("business mobile drawer uses text-only identity (logo stays in header)");
} else fail("business mobile drawer still shows sidebar logo");

const employeePageHeader = read("src/app/components/employee/EmployeePageHeader.tsx");
if (
  employeePageHeader.includes("employee-page-header--surface") &&
  employeePageHeader.includes("max-lg:flex")
) {
  pass("employee page header uses surface-first mobile layout");
} else fail("employee page header mobile surface layout missing");

if (
  mobileTheme.includes("employee-page-header--surface") &&
  mobileTheme.includes("employee-settings-section") &&
  mobileTheme.includes("physical-qr-order-detail")
) {
  pass("mobile theme surface-first rules extended");
} else fail("mobile theme surface-first extension incomplete");

const mobileCss = read("src/styles/caretip-dashboard-mobile.css");
if (
  mobileCss.includes(".print-qr-studio") &&
  mobileCss.includes(".platform-physical-qr") &&
  mobileCss.includes("overflow-wrap: anywhere")
) {
  pass("mobile CSS contains print studio and admin physical branding");
} else fail("mobile CSS missing physical branding containment");

const tipGoalsPage = read("src/app/pages/employee/EmployeeTipGoalsPage.tsx");
if (
  tipGoalsPage.includes("employee-tip-goals-surface") &&
  !tipGoalsPage.includes("employeeUi.cardStatic") &&
  !tipGoalsPage.includes("<Card ")
) {
  pass("employee tip goals uses flat surface (no wrapping card)");
} else fail("employee tip goals still uses a wrapping card");

const emptyState = read("src/app/components/dashboard/DashboardWorkspaceEmptyState.tsx");
if (emptyState.includes("dashboard-workspace-empty--compact")) {
  pass("compact empty states use flat surface (no card chrome)");
} else fail("compact empty states still use card chrome");

const assignmentCard = read("src/app/components/employee/EmployeeAssignmentCard.tsx");
if (
  assignmentCard.includes("employee-assignment-panel") &&
  !assignmentCard.includes("employeeUi.card") &&
  assignmentCard.includes("EmployeeEmptyState")
) {
  pass("employee assignment panel is surface-first (no wrapping card)");
} else fail("employee assignment still wrapped in decorative card");

const performance = read("src/app/components/employee/EmployeePerformanceInsights.tsx");
if (
  performance.includes("dashboard-mobile-flat-surface") &&
  performance.includes("employee-performance-insights__tile")
) {
  pass("employee performance insights uses flat surface + light tiles");
} else fail("employee performance insights mobile flattening incomplete");

const goalCard = read("src/app/components/employee/EmployeeGoalCard.tsx");
if (goalCard.includes("employee-goal-card") && goalCard.includes("rounded-lg") && !goalCard.includes("rounded-2xl")) {
  pass("employee goal card uses moderate radius (not oversized rounded-2xl)");
} else fail("employee goal card still uses oversized radius");

if (
  mobileTheme.includes("dashboard-workspace-empty--compact") &&
  mobileTheme.includes("employee-goal-card") &&
  mobileTheme.includes("employee-hero-account-stats > div") &&
  mobileTheme.includes("box-shadow: none !important")
) {
  pass("mobile theme densifies hero metrics and flattens empty/goal chrome");
} else fail("mobile theme surface densify rules incomplete");

const rnAssignment = read("mobile/features/employee/EmployeeAssignmentScreen.tsx");
if (
  rnAssignment.includes('surface="flat"') &&
  rnAssignment.includes("tableList") &&
  !rnAssignment.includes("GroupedList")
) {
  pass("RN assignment uses flat empty + divider list (no grouped card)");
} else fail("RN assignment still uses grouped card chrome");

const profilePage = read("src/app/pages/business/BusinessProfilePage.tsx");
if (profilePage.includes("dashboard-mobile-flat-surface")) {
  pass("business profile uses mobile-flat sections");
} else fail("business profile mobile-flat missing");

const staffPage = read("src/app/pages/business/StaffManagementPage.tsx");
if (
  staffPage.includes("dashboard-mobile-flat-surface") &&
  staffPage.includes("dashboard-at-a-glance--mobile-flat") &&
  staffPage.includes("mobileFlatSection")
) {
  pass("staff page uses mobile-flat invite, glance, and flat search");
} else fail("staff page mobile flattening incomplete");

const stripeCard = read("src/app/components/business/settings/billing/BusinessStripeConnectCard.tsx");
if (
  stripeCard.includes("stripe-connect-card") &&
  stripeCard.includes("nextStepHint") &&
  !stripeCard.includes("readinessRequired") &&
  !stripeCard.includes("business.billing.connect.title")
) {
  pass("Stripe connect panel is status + action only (no duplicate heading stack)");
} else fail("Stripe connect panel still repeats title/readiness stack");

const stripeLayout = read("src/app/pages/business/stripe/BusinessStripeLayout.tsx");
if (stripeLayout.includes("hideSubtitleOnMobile")) {
  pass("Stripe module hides duplicate subtitle on mobile");
} else fail("Stripe layout mobile subtitle hide missing");

const activityPage = read("src/app/pages/business/tips/BusinessActivityCenterPage.tsx");
if (!activityPage.includes("business.tips.liveDesc")) {
  pass("Activity Center no longer repeats liveDesc essay");
} else fail("Activity Center still shows liveDesc");

const payouts = read("src/app/components/business/settings/billing/ConnectPayoutsPanel.tsx");
if (!payouts.includes("reconExplainI18nKey") && payouts.includes("ConnectPayoutStatusBadge")) {
  pass("Payout list omits recon explain paragraphs");
} else fail("Payout list still stacks recon explain copy");

const moduleHeader = read("src/app/components/business/BusinessModuleWorkspaceHeader.tsx");
if (moduleHeader.includes("subtitle.trim()")) {
  pass("Module header skips empty subtitles");
} else fail("Module header still always renders subtitle");

const en = JSON.parse(read("src/i18n/locales/en.json")) as any;
const statusIncomplete = en?.business?.billing?.connect?.statusIncomplete as string | undefined;
const statusReady = en?.business?.billing?.connect?.statusReady as string | undefined;
const nextHint = en?.business?.billing?.connect?.nextStepHint as string | undefined;
const stripeModule = en?.business?.stripe?.moduleSubtitle as string | undefined;
const payoutHint = en?.business?.billing?.payouts?.hint as string | undefined;
const tipsSubtitle = en?.business?.tips?.subtitle as string | undefined;
const liveDesc = en?.business?.tips?.liveDesc as string | undefined;

if (statusIncomplete === "Stripe setup incomplete") {
  pass("Stripe incomplete status is one short line");
} else fail(`Stripe incomplete status unexpected: ${statusIncomplete}`);

if (statusReady === "Stripe ready") {
  pass("Stripe ready status is one short line");
} else fail(`Stripe ready status unexpected: ${statusReady}`);

if (nextHint && nextHint.length <= 80) {
  pass("Stripe next-step hint is concise");
} else fail("Stripe next-step hint missing or too long");

if (stripeModule && stripeModule.length <= 60) {
  pass("Stripe module subtitle concise");
} else fail("Stripe module subtitle too long");

if (payoutHint && payoutHint.length <= 70 && !/CareTip does not send/i.test(payoutHint)) {
  pass("Payout hint is concise and non-technical");
} else fail(`Payout hint still verbose: ${payoutHint}`);

if (tipsSubtitle === "" && liveDesc === "") {
  pass("Tips module redundant subtitles cleared");
} else fail("Tips module still has redundant subtitle/liveDesc");

if ((en?.employee?.assignment?.subtitle ?? "x") === "") {
  pass("Employee assignment subtitle cleared (title sufficient)");
} else fail("Employee assignment subtitle still present");

if (
  (en?.notifications?.inbox?.emptyHint ?? "x") === "" &&
  (en?.notifications?.inbox?.emptyBodyPremium ?? "x") === ""
) {
  pass("Inbox empty body/hint cleared");
} else fail("Inbox empty copy still present");

if ((en?.business?.qrStudio?.subtitle ?? "x") === "") {
  pass("QR Studio redundant subtitle cleared");
} else fail("QR Studio subtitle still present");

const locationsPageSrc = read("src/app/pages/business/LocationsPage.tsx");
if (
  typeof en?.business?.locationsPage?.subtitle === "string" &&
  en.business.locationsPage.subtitle.length > 0 &&
  locationsPageSrc.includes("hideSubtitleOnMobile")
) {
  pass("Locations / Tables subtitle exists and is hidden on mobile");
} else fail("Locations / Tables subtitle should exist and use hideSubtitleOnMobile");

const mobileEn = read("mobile/i18n/locales/en.ts");
if (
  mobileEn.includes('subtitle: ""') &&
  mobileEn.includes("Ask your manager to assign one.") &&
  mobileEn.includes('emptyMessage: ""') &&
  mobileEn.includes("Share this code so staff can join")
) {
  pass("Mobile assignment/inbox/team copy aligned with concise web style");
} else fail("Mobile copy alignment incomplete");

const teamScreen = read("mobile/features/business/TeamManagementScreen.tsx");
if (teamScreen.includes("inviteBlock") && !teamScreen.includes("inviteCard")) {
  pass("Mobile team invite uses flat block (no decorative card)");
} else fail("Mobile team invite still wrapped in decorative card");

for (const rel of [
  "e2e/employee-dashboard-mobile-overflow.spec.ts",
  "e2e/helpers/overflowAudit.ts",
]) {
  if (exists(rel)) pass(`overflow helper present ${rel}`);
  else fail(`missing ${rel}`);
}

const failed = results.filter((r) => r.startsWith("FAIL"));
for (const line of results) console.log(line);
if (failed.length) {
  console.error(`\n${failed.length} dashboard mobile UI check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} dashboard mobile UI checks passed`);
