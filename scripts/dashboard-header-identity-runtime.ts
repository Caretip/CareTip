/**
 * Header identity + stale bootstrap epoch locks.
 * Run: npm run test:dashboard-header-identity
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDashboardHeaderIdentity } from "../src/app/lib/dashboardHeaderIdentity";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const copy = { platformAdminName: "Admin", platformAdminEmail: "Platform admin" };

const unknown = resolveDashboardHeaderIdentity(null, copy);
assert(!unknown.showProfileCluster, "no user → no profile cluster");
assert(unknown.displayName === "", "no user → no Admin fallback name");
assert(unknown.displayEmail === "", "no user → no Platform admin fallback email");

const nameless = resolveDashboardHeaderIdentity({ role: "business", name: "", email: "" }, copy);
assert(!nameless.showProfileCluster, "manager without name/email does not become Admin");

const manager = resolveDashboardHeaderIdentity(
  { role: "business", name: "Maria", email: "maria@example.com" },
  copy,
);
assert(manager.showProfileCluster, "manager with profile shows cluster");
assert(manager.displayName === "Maria", "manager name is authoritative");
assert(manager.displayEmail === "maria@example.com", "manager email is authoritative");
assert(manager.displayName !== "Admin", "manager cannot render Admin");
assert(manager.displayEmail !== "Platform admin", "manager cannot render Platform admin");

const employee = resolveDashboardHeaderIdentity(
  { role: "employee", name: "Sarah", email: "employee@example.com" },
  copy,
);
assert(employee.displayName === "Sarah", "employee name is authoritative");
assert(!employee.displayName.includes("Admin"), "employee cannot render Admin");

const emptyEmployee = resolveDashboardHeaderIdentity({ role: "employee", name: "  ", email: "" }, copy);
assert(!emptyEmployee.showProfileCluster, "employee without identity does not invent Admin");

const admin = resolveDashboardHeaderIdentity({ role: "platform_admin", name: "", email: "" }, copy);
assert(admin.showProfileCluster, "known platform admin may use admin copy");
assert(admin.displayName === "Admin", "platform admin fallback name only when role is platform admin");
assert(admin.displayEmail === "Platform admin", "platform admin fallback email only when role is platform admin");

const header = read("src/app/components/DashboardHeader.tsx");
assert(header.includes("resolveDashboardHeaderIdentity"), "DashboardHeader uses shared identity resolver");
assert(
  !header.includes('user?.name?.trim() || t("shell.header.adminFallback")'),
  "DashboardHeader must not use Admin as a missing-name fallback",
);

const bootstrap = read("src/app/lib/authSessionBootstrap.ts");
assert(bootstrap.includes("getSessionEpoch() !== epochAtStart"), "stale bootstrap must not apply after epoch bump");
assert(bootstrap.includes("getSessionEpoch() === lastBootstrapEpoch"), "stale bootstrap replay is epoch-gated");

const businessLayout = read("src/app/layouts/BusinessLayout.tsx");
assert(
  businessLayout.includes("!globalLoaderActive && user?.role === \"business\""),
  "business sidebar skeleton only while this session is a manager",
);
const employeeLayout = read("src/app/layouts/EmployeeLayout.tsx");
assert(
  employeeLayout.includes("!globalLoaderActive && user?.role === \"employee\""),
  "employee sidebar skeleton only while this session is staff",
);

console.log("dashboard-header-identity-runtime: ok");
