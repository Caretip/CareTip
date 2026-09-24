/**
 * Validates dashboard quick-access hrefs against business sidebar child routes.
 * Run: npx tsx src/app/components/business/businessDashboardQuickAccess.runtime.ts
 */
import assert from "node:assert/strict";
import { businessDashboardQuickAccessItems } from "./businessDashboardQuickAccess";
import {
  businessSidebarNavEntries,
  tipsSubNavItems,
  QR_STUDIO_BASE,
  TEAM_BASE,
} from "./businessDashboardNav";

const CHILD_HREFS = new Set(
  businessSidebarNavEntries.flatMap((e) =>
    e.type === "group" ? e.children.map((c) => c.href) : [],
  ),
);

const BLOCKED_PARENT_ONLY_HREFS = new Set([
  QR_STUDIO_BASE,
  TEAM_BASE,
  "/dashboard/tips",
  "/dashboard/customers",
  "/dashboard/locations",
  "/dashboard/stripe",
  "/dashboard/billing",
]);

for (const item of businessDashboardQuickAccessItems) {
  assert.ok(CHILD_HREFS.has(item.href), `${item.href} must be a sidebar child route`);
  assert.ok(!BLOCKED_PARENT_ONLY_HREFS.has(item.href), `${item.href} must not be a parent-only href`);
  assert.ok(item.href.startsWith("/dashboard/"), `${item.href} must be under /dashboard`);
}

assert.equal(businessDashboardQuickAccessItems.length, 2);
assert.ok(
  !businessDashboardQuickAccessItems.some((i) => i.href.endsWith("/tip-distribution")),
  "does not include tip distribution hero button",
);
assert.ok(
  businessDashboardQuickAccessItems.some((i) => i.href.endsWith("/transactions")),
  "includes tips history",
);
assert.ok(
  businessDashboardQuickAccessItems.some((i) => i.href.endsWith("/analytics")),
  "includes analytics",
);
assert.equal(businessDashboardQuickAccessItems[0]?.id, "analytics", "analytics is first / primary");
assert.equal(businessDashboardQuickAccessItems[0]?.isPrimary, true, "analytics is primary CTA");

assert.ok(
  !businessDashboardQuickAccessItems.some((i) => i.href === QR_STUDIO_BASE),
  "does not link top-level QR Studio",
);
assert.ok(
  !businessDashboardQuickAccessItems.some((i) => i.href.startsWith(`${TEAM_BASE}/performance`)),
  "does not duplicate team performance top shortcut",
);

const tipsChildHrefs = tipsSubNavItems.map((i) => i.href);
for (const item of businessDashboardQuickAccessItems) {
  const match = tipsSubNavItems.find((t) => t.href === item.href);
  assert.ok(match, `${item.href} must exist in tipsSubNavItems`);
  assert.equal(item.labelKey, match.labelKey);
}

console.log("business-dashboard-quick-access: OK");
