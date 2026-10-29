/**
 * Employee tip notification preferences.
 * Channels are independent, tip email stays opt-in, and business settings stay put.
 * Run: npm run test:employee-tip-notification-prefs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_EMPLOYEE_TIP_NOTIFICATION_PREFS,
  effectiveEmployeeTipNotificationPrefs,
  employeeTipEmailCopy,
  employeeTipPrefsBeforeChannelColumns,
  resolveEmployeeTipDeliveryChannels,
} from "../src/services/notifications/employeeTipNotificationPrefs.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

assert.deepEqual(DEFAULT_EMPLOYEE_TIP_NOTIFICATION_PREFS, {
  tipInAppNotifications: true,
  tipPushNotifications: true,
  tipEmailNotifications: false,
});
assert.equal(effectiveEmployeeTipNotificationPrefs(null).tipEmailNotifications, false);
assert.equal(effectiveEmployeeTipNotificationPrefs({ tipPushNotifications: false }).tipInAppNotifications, true);
assert.equal(effectiveEmployeeTipNotificationPrefs({ tipEmailNotifications: true }).tipPushNotifications, true);
assert.deepEqual(employeeTipPrefsBeforeChannelColumns(false), {
  tipInAppNotifications: true,
  tipPushNotifications: false,
  tipEmailNotifications: false,
});

const mixed = resolveEmployeeTipDeliveryChannels({
  tipInAppNotifications: false,
  tipPushNotifications: true,
  tipEmailNotifications: false,
});
assert.deepEqual(mixed, { in_app: false, push: true, email: false });
assert.equal(
  resolveEmployeeTipDeliveryChannels({
    tipInAppNotifications: true,
    tipPushNotifications: false,
    tipEmailNotifications: true,
  }).push,
  false,
);
assert.equal(
  resolveEmployeeTipDeliveryChannels({
    tipInAppNotifications: true,
    tipPushNotifications: false,
    tipEmailNotifications: true,
  }).email,
  true,
);

for (const locale of ["en", "de"] as const) {
  const copy = employeeTipEmailCopy(locale);
  assert.match(copy.title, locale === "de" ? /Trinkgeld/ : /tip/i);
  assert.doesNotMatch(copy.title, /€|\$|\d/);
  assert.doesNotMatch(copy.bodyText, /€|\$|payment|stripe|guest|kunde/i);
  assert.doesNotMatch(`${copy.title} ${copy.bodyText}`, /customerName|amount/);
}

const triggers = read("src/services/push/notification.triggers.ts");
const employeeTip = triggers.slice(
  triggers.indexOf("export function onTipReceived"),
  triggers.indexOf("export function onPayoutCompleted"),
);
assert.match(employeeTip, /payload\.tip\.status !== "success"/);
assert.match(employeeTip, /employee\.businessId !== payload\.businessId/);
assert.match(employeeTip, /resolveEmployeeTipDeliveryChannels\(tipPrefs\)/);
assert.match(employeeTip, /emailPrivacy: "employee_tip"/);
assert.match(employeeTip, /pushPrivacy: "employee_tip"/);
assert.match(employeeTip, /employeeTipChannelColumnsReady/);
assert.match(employeeTip, /dedupeKey: `tip:\$\{payload\.tip\.id\}:employee:/);
const managerCall = employeeTip.slice(employeeTip.lastIndexOf("deliverUserNotification"));
assert.doesNotMatch(managerCall, /emailPrivacy/);
assert.doesNotMatch(managerCall, /channels:/);

const pushGate = read("src/services/push/notification.service.ts");
assert.match(pushGate, /if \(user\.role === "EMPLOYEE"\) return employeeTipPush/);
assert.match(pushGate, /if \(user\.role === "MANAGER"\) return settings\?\.tipReceivedNotifications/);
assert.match(pushGate, /employeeTipChannelColumnsReady/);

const stripe = read("src/services/stripe.service.ts");
const failed = stripe.slice(stripe.indexOf("export async function handlePaymentFailed"));
assert.doesNotMatch(failed, /emitNewTip|onTipReceived/);

const orchestrator = read("src/services/notifications/notificationOrchestrator.service.ts");
assert.match(orchestrator, /type: wantsInbox \? deliveryPayload\.type : "delivery_anchor"/);
assert.match(orchestrator, /\.catch\(\(err\) => \{\s*logServerError\("notifications\.deliverUserNotification\.push"/);
assert.match(orchestrator, /notifications\.deliverUserNotification\.email/);
assert.match(orchestrator, /delete pushMeta\.customerName/);
assert.match(orchestrator, /delete pushMeta\.amount/);
assert.match(orchestrator, /metadataForHiddenEmployeeTip\(metadata\)/);

const inbox = read("src/services/notifications/notificationInbox.service.ts");
assert.match(inbox, /type: \{ not: "delivery_anchor" \}/);

const controller = read("src/controllers/employee.controller.ts");
assert.match(controller, /function strictBoolean/);
const patch = controller.slice(
  controller.indexOf("export async function patchMyProfile"),
  controller.indexOf("export async function uploadMyAvatar"),
);
assert.match(patch, /updateEmployeeSelf\(userId/);
assert.doesNotMatch(patch, /req\.params/);
assert.match(patch, /!updated\.pushNotifications && !updated\.tipPushNotifications/);

const routes = read("src/routes/employee.routes.ts");
const mePatch = routes.slice(routes.indexOf('"/me"'), routes.indexOf('"/me/reactivate-receiving"'));
assert.match(mePatch, /requireRole\(Role\.EMPLOYEE\)/);
assert.match(mePatch, /patchMyProfile/);

const schema = read("prisma/schema.prisma");
assert.match(schema, /tipInAppNotifications\s+Boolean\s+@default\(true\)/);
assert.match(schema, /tipPushNotifications\s+Boolean\s+@default\(true\)/);
assert.match(schema, /tipEmailNotifications\s+Boolean\s+@default\(false\)/);
assert.match(schema, /tipReceivedNotifications\s+Boolean\s+@default\(true\)/);

const migration = read(
  "prisma/migrations/20261029120000_employee_tip_notification_channels/migration.sql",
);
assert.match(migration, /tip_email_notifications" BOOLEAN NOT NULL DEFAULT false/);
assert.match(migration, /SET "tip_push_notifications" = "push_notifications"/);

const businessPanel = read("../src/app/components/business/settings/BusinessSettingsNotificationsPanel.tsx");
assert.match(businessPanel, /tipReceivedNotifications/);
assert.match(businessPanel, /systemAlerts/);
assert.match(businessPanel, /notifyNewLogin/);
assert.doesNotMatch(businessPanel, /tipEmailNotifications|tipInAppNotifications/);

const employeeService = read("src/services/employee.service.ts");
assert.match(employeeService, /employeeTipChannelColumnsReady/);
assert.match(employeeService, /employeeTipPrefsBeforeChannelColumns/);

console.log("employee-tip-notification-prefs-runtime: ok");
