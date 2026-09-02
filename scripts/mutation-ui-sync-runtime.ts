/**
 * Mutation → UI sync: write-through after create/update/delete, no stale cache-first paint.
 * Run: npm run test:mutation-ui-sync
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPlanLimitsForTier } from "../src/app/lib/subscriptionCapabilities";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

const root = path.dirname(fileURLToPath(new URL(".", import.meta.url)));

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const basicLimits = getPlanLimitsForTier("basic");
if (basicLimits.maxLocations === 1 && basicLimits.maxTables === 1) {
  pass("Basic limits remain 1 location / 1 table");
} else {
  fail(`Basic limits drifted: ${JSON.stringify(basicLimits)}`);
}

const locationsPage = read("src/app/pages/business/LocationsPage.tsx");
if (
  locationsPage.includes("applyVenue") &&
  locationsPage.includes("const created = await createLocationAPI") &&
  locationsPage.includes("[...locations, created]") &&
  locationsPage.includes("void load({ quiet: true })")
) {
  pass("Locations create applies the mutation DTO then quietly revalidates");
} else {
  fail("Locations create must apply the API response before a quiet reload");
}

if (
  locationsPage.includes("const updated = await updateLocationAPI") &&
  locationsPage.includes("row.id === updated.id") &&
  locationsPage.includes("await deleteLocationAPI") &&
  locationsPage.includes("locations.filter((row) => row.id !== removedId)")
) {
  pass("Locations update/delete apply local state from the successful mutation");
} else {
  fail("Locations update/delete must not wait on a blocking list GET");
}

if (/await load\(\)/.test(locationsPage)) {
  fail("LocationsPage still blocks the UI on a full load() after mutation");
} else {
  pass("Locations mutations do not await a blocking load()");
}

if (
  locationsPage.includes("const created = await createTableAPI") &&
  locationsPage.includes("applyVenue") &&
  locationsPage.includes("tables: [...tables, row]") &&
  locationsPage.includes("void load({ quiet: true })")
) {
  pass("Tables create on Locations / Tables applies the mutation DTO then quietly revalidates");
} else {
  fail("Tables create must apply the API response before a quiet reload");
}

if (/await load\(\)/.test(locationsPage) || /await loadAll\(\)/.test(locationsPage)) {
  fail("LocationsPage still blocks the UI on a full load() after mutation");
} else {
  pass("Location and table mutations do not await a blocking load()");
}

const tablesPage = read("src/app/pages/business/TablesPage.tsx");
if (!tablesPage.includes("createTableAPI") && !tablesPage.includes("business.tablesPage.create")) {
  pass("QR Studio TablesPage no longer creates tables");
} else {
  fail("QR Studio TablesPage still contains table creation");
}

const catalog = read("src/app/lib/businessVenueCatalog.ts");
if (
  catalog.includes("Promise.all([") &&
  catalog.includes("fetchLocations()") &&
  catalog.includes("fetchTables({ silent: true })") &&
  catalog.includes("writeVenueCatalogLocations") &&
  catalog.includes("writeVenueCatalogTables") &&
  catalog.includes("export function writeVenueCatalog")
) {
  pass("Venue catalog fetches locations+tables in parallel and supports write-through");
} else {
  fail("Venue catalog missing parallel fetch or write-through helpers");
}

const staffPage = read("src/app/pages/business/StaffManagementPage.tsx");
if (
  staffPage.includes("await createEmployee(") &&
  staffPage.includes('activationStatus: "pending_activation"') &&
  staffPage.includes("void fetchEmployees({ quiet: true, revalidate: true })")
) {
  pass("Staff add applies the created employee then revalidates with cache bypass");
} else {
  fail("Staff add must not reuse the 45s stats cache without revalidate");
}

if (/await fetchEmployees\(\)/.test(staffPage)) {
  fail("Staff add still awaits fetchEmployees() without revalidate");
} else {
  pass("Staff add does not await an unrevalidated roster GET");
}

const profileApi = read("src/app/lib/api.ts");
if (
  profileApi.includes("export async function putBusinessProfile") &&
  profileApi.includes("businessProfileCache = { at: Date.now(), data: result }")
) {
  pass("putBusinessProfile write-throughs the profile client cache");
} else {
  fail("putBusinessProfile must cache the PUT response");
}

const profilePage = read("src/app/pages/business/BusinessProfilePage.tsx");
if (
  profilePage.includes("const saved = await putBusinessProfile") &&
  profilePage.includes("hadPendingLogo") &&
  profilePage.includes("fetchBusinessProfile({ revalidate: true })")
) {
  pass("Business profile uses the PUT body unless a logo upload requires a follow-up GET");
} else {
  fail("BusinessProfilePage still always GETs after a successful PUT");
}

const goalsPage = read("src/app/pages/employee/EmployeeTipGoalsPage.tsx");
if (
  goalsPage.includes("const { goal } = await createMyGoal") &&
  goalsPage.includes("const { goal } = await updateMyGoal") &&
  goalsPage.includes("void refresh()")
) {
  pass("Employee goals apply the mutation goal then quietly refresh");
} else {
  fail("Employee tip goals still wait on a blocking list GET after save");
}

const locationsService = read("backend/src/services/locations.service.ts");
if (
  locationsService.includes("const [entitlements, count] = await Promise.all") &&
  locationsService.includes("isWithinPlanLimit(entitlements.subscriptionTier, \"locations\", count)") &&
  !locationsService.includes("assertPlanLimitForBusiness")
) {
  pass("Location create resolves entitlements+count in parallel without a second entitlement resolve");
} else {
  fail("Location create still double-resolves entitlements or runs count sequentially");
}

const tablesService = read("backend/src/services/tables.service.ts");
if (
  tablesService.includes("const [entitlements, tableCount] = await Promise.all") &&
  tablesService.includes("isWithinPlanLimit(entitlements.subscriptionTier, \"tables\", tableCount)") &&
  /prisma\.table\.create\(\{[\s\S]*?include:[\s\S]*?location:\s*\{\s*select:\s*\{\s*id:\s*true,\s*name:\s*true/.test(
    tablesService,
  ) &&
  !tablesService.includes("assertPlanLimitForBusiness")
) {
  pass("Table create parallelizes entitlements+count and returns nested location");
} else {
  fail("Table create missing parallel limit check or location include");
}

const orchestrator = read("backend/src/services/notifications/notificationOrchestrator.service.ts");
if (
  orchestrator.includes("emitNotificationCreated") &&
  orchestrator.includes("void sendNotification(") &&
  !/await sendNotification\(/.test(orchestrator)
) {
  pass("In-app socket emit is not blocked on FCM push delivery");
} else {
  fail("deliverUserNotification still awaits FCM before returning");
}

if (orchestrator.includes("void sendLocalizedUserNotificationEmail")) {
  pass("Notification email remains fire-and-forget");
} else {
  fail("Notification email path drifted");
}

const employeeService = read("backend/src/services/employee.service.ts");
if (
  employeeService.includes("void sendEmployeeActivationEmail(") &&
  employeeService.includes("const [existing, business] = await Promise.all")
) {
  pass("Employee create does not wait for invite email; email uniqueness and business load run in parallel");
} else {
  fail("Employee create still blocks on invite email or sequential uniqueness lookups");
}

const inboxSync = read("src/app/components/NotificationInboxSync.tsx");
if (inboxSync.includes("useRealtimeFallback(connected, catchUp, 30_000)")) {
  pass("In-app inbox fallback polling stays at 30s when the socket is down");
} else {
  fail("Notification polling interval drifted");
}

const tableIndex = read("backend/prisma/schema.prisma");
if (tableIndex.includes("@@index([locationId])") && tableIndex.includes('@@map("venue_tables")')) {
  pass("Existing venue_tables(location_id) index is preserved (not duplicated)");
} else {
  fail("venue_tables location_id index missing");
}

const failed = results.filter((r) => r.startsWith("FAIL:")).length;
console.log(results.join("\n"));
if (failed) {
  console.error(`\n${failed} mutation-ui-sync check(s) failed`);
  process.exit(1);
}
console.log(`\n${results.length} mutation-ui-sync checks passed`);
