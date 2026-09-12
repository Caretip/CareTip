/**
 * Notification / realtime architecture regression guard.
 * Run: npm run test:notifications-realtime-deep
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeLiveTipIntoActivity } from "../src/app/lib/realtime/mergeLiveTipIntoActivity.ts";
import {
  resetRealtimeEventDedupeForTests,
  shouldProcessRealtimeEvent,
  tipRealtimeDedupeId,
} from "../src/app/lib/realtime/realtimeEventDedupe.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
function pass(msg: string) {
  console.log(`OK: ${msg}`);
}
function fail(msg: string) {
  console.error(`FAIL: ${msg}`);
  failed += 1;
}
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const tipsPage = read("src/app/pages/shared/TipsActivityPage.tsx");
if (
  tipsPage.includes("useTipsActivityRealtime") &&
  tipsPage.includes("mergeLiveTipIntoActivity") &&
  tipsPage.includes('load({ quiet: true })') &&
  !/setInterval\s*\(/.test(tipsPage)
) {
  pass("Tip history/activity applies live tips and quiet-refetches without polling");
} else {
  fail("TipsActivityPage is missing event-driven live tip wiring, or introduced polling");
}

const stripeService = read("backend/src/services/stripe.service.ts");
if (
  stripeService.includes("await prisma.$transaction") &&
  stripeService.includes("emitTipSocketWithSnapshot") &&
  stripeService.indexOf("await prisma.$transaction") < stripeService.lastIndexOf("emitTipSocketWithSnapshot")
) {
  pass("Tip socket emit occurs after the payment persist transaction");
} else {
  fail("Tip emit may run before the ledger transaction");
}

const emitTip = read("backend/src/socket/emitTip.ts");
if (
  emitTip.includes('emitTipReceivedCanonical') &&
  emitTip.includes('io.to(`business:${payload.businessId}`).emit("tip_received"') &&
  emitTip.includes("onTipReceived")
) {
  pass("emitNewTip publishes tenant rooms then inbox/push asynchronously");
} else {
  fail("emitNewTip no longer publishes rooms or notifications");
}

const rooms = read("backend/src/socket/socketServer.ts");
if (
  rooms.includes("employee:${socket.data.employeeId}") &&
  rooms.includes("business:${socket.data.businessId}") &&
  rooms.includes("handshake.auth.token")
) {
  pass("Socket joins are server-side from JWT (employee/business rooms)");
} else {
  fail("Socket room join contract changed");
}

const socketProvider = read("src/app/context/SocketProvider.tsx");
if (socketProvider.includes("s.auth = { token: fresh }") && socketProvider.includes("AUTH_STORAGE_SYNC_EVENT")) {
  pass("Socket refreshes handshake token on reconnect and auth sync");
} else {
  fail("Socket reconnect is missing fresh JWT handshake");
}

const dashboardDedupe = read("src/app/components/business/BusinessDashboardRealtimeSync.tsx");
const analyticsDedupe = read("src/app/hooks/useBusinessAnalytics.ts");
if (
  dashboardDedupe.includes('"business-dashboard-tips"') &&
  analyticsDedupe.includes('"business-analytics-tips"') &&
  dashboardDedupe.includes("tipRealtimeDedupeId")
) {
  pass("Business dashboard and analytics each consume tip events with scoped dedupe");
} else {
  fail("Business live-tip listeners still share a global event-id set");
}

const employeeSync = read("src/app/components/employee/EmployeeDashboardRealtimeSync.tsx");
if (employeeSync.includes('"employee-dashboard-tips"') && employeeSync.includes("tipRealtimeDedupeId")) {
  pass("Employee dashboard dedupes canonical + legacy tip sockets per tip id");
} else {
  fail("Employee dashboard can double-apply canonical + legacy tip events");
}

const payoutNav = read("src/app/lib/notificationNavigation.ts");
if (
  payoutNav.includes('return "/employee/payments/history"') &&
  payoutNav.includes('return "/dashboard/stripe/payouts"') &&
  payoutNav.includes('return "viewPayout"')
) {
  pass("Paid-payout inbox items deep-link to payout history");
} else {
  fail("Payout notification destinations are still tip history");
}

const payoutTrigger = read("backend/src/services/push/notification.triggers.ts");
if (
  payoutTrigger.includes("/employee/payments/history") &&
  payoutTrigger.includes("/dashboard/stripe/payouts") &&
  payoutTrigger.includes("payoutStatus !== \"paid\"")
) {
  pass("Payout completed notify fires only after payoutStatus is paid");
} else {
  fail("Payout notification trigger is inaccurate or mis-linked");
}

const inactivity = read("backend/src/services/employeeStripeInactivity.service.ts");
if (
  inactivity.includes("employee-inactivity-warning:") &&
  inactivity.includes("employee-inactivity-admin:") &&
  inactivity.includes("inactivityWarningSentAt")
) {
  pass("45-day inactivity warning/admin notify uses durable dedupe keys");
} else {
  fail("Inactivity notification dedupe is missing");
}

const webhook = read("backend/src/webhooks/stripe.webhook.ts");
if (
  webhook.includes("isStripeWebhookEventProcessed") &&
  webhook.includes("[stripe.webhook] processed") &&
  webhook.includes("durationMs")
) {
  pass("Stripe webhook records duration and skips duplicate event ids");
} else {
  fail("Stripe webhook observability/idempotency guard missing");
}

const inbox = read("backend/prisma/schema.prisma");
if (
  inbox.includes("@@unique([userId, dedupeKey])") &&
  inbox.includes("@@index([userId, createdAt(sort: Desc)])") &&
  inbox.includes("@@index([userId, readAt])")
) {
  pass("Notification table has user/dedupe uniqueness and unread indexes");
} else {
  fail("Notification indexes/dedupe unique constraint missing");
}

resetRealtimeEventDedupeForTests();
const tipId = "tip_abc";
const first = shouldProcessRealtimeEvent(tipRealtimeDedupeId({ tip: { id: tipId } }, "uuid-1"), "a");
const secondSameScope = shouldProcessRealtimeEvent(
  tipRealtimeDedupeId({ tip: { id: tipId } }, "uuid-2"),
  "a",
);
const otherConsumer = shouldProcessRealtimeEvent(
  tipRealtimeDedupeId({ tip: { id: tipId } }, "uuid-3"),
  "b",
);
if (first && !secondSameScope && otherConsumer) {
  pass("Scoped dedupe collapses canonical/legacy aliases without silencing other consumers");
} else {
  fail("Scoped realtime dedupe behavior is incorrect");
}

const mergedOnce = mergeLiveTipIntoActivity([], {
  tip: { id: "t1", amount: 5, status: "success", createdAt: "2026-09-12T00:00:00.000Z" },
  employeeId: "e1",
  employeeName: "Ada",
  businessId: "b1",
});
const mergedTwice = mergeLiveTipIntoActivity(mergedOnce.items, {
  tip: { id: "t1", amount: 5, status: "success", createdAt: "2026-09-12T00:00:00.000Z" },
  employeeId: "e1",
  businessId: "b1",
});
if (mergedOnce.added && mergedOnce.items.length === 1 && !mergedTwice.added && mergedTwice.items.length === 1) {
  pass("Live tip list merge is idempotent on tip id");
} else {
  fail("Live tip list merge is not idempotent");
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nnotifications-realtime-deep: all checks passed");
