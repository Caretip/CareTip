/**
 * Phase 2 notification settings — defaults, login pref, and UI truthfulness locks.
 * Run: npx tsx scripts/notification-settings-phase2-runtime.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_USER_NOTIFICATION_SETTINGS,
  effectiveNotifyNewLogin,
  effectiveUserNotificationSettings,
} from "../backend/src/services/notifications/userNotificationSettingsDefaults.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

assert.equal(DEFAULT_USER_NOTIFICATION_SETTINGS.notifyNewLogin, true);
assert.equal(DEFAULT_USER_NOTIFICATION_SETTINGS.tipReceivedNotifications, true);
assert.equal(DEFAULT_USER_NOTIFICATION_SETTINGS.systemAlerts, true);
assert.equal(DEFAULT_USER_NOTIFICATION_SETTINGS.summaryEmails, false);

assert.equal(effectiveNotifyNewLogin(null), true);
assert.equal(effectiveNotifyNewLogin(undefined), true);
assert.equal(effectiveNotifyNewLogin({ notifyNewLogin: true }), true);
assert.equal(effectiveNotifyNewLogin({ notifyNewLogin: false }), false);

assert.deepEqual(effectiveUserNotificationSettings(null), { ...DEFAULT_USER_NOTIFICATION_SETTINGS });
assert.equal(effectiveUserNotificationSettings({ tipReceivedNotifications: false }).tipReceivedNotifications, false);
assert.equal(effectiveUserNotificationSettings({ tipReceivedNotifications: false }).notifyNewLogin, true);

const loginSvc = read("backend/src/services/loginNotification.service.ts");
assert.match(loginSvc, /effectiveNotifyNewLogin/);
assert.doesNotMatch(loginSvc, /if \(!settings\?\.notifyNewLogin\) return/);

const settingsCtrl = read("backend/src/controllers/settings.controller.ts");
assert.match(settingsCtrl, /effectiveUserNotificationSettings/);
assert.match(settingsCtrl, /DEFAULT_USER_NOTIFICATION_SETTINGS/);

const bizPanel = read("src/app/components/business/settings/BusinessSettingsNotificationsPanel.tsx");
assert.doesNotMatch(bizPanel, /summaryTitle/);
assert.match(bizPanel, /tipNotifTitle/);
assert.match(bizPanel, /systemTitle/);
assert.match(bizPanel, /loginTitle/);

const empPage = read("src/app/pages/employee/EmployeeSettingsPage.tsx");
assert.doesNotMatch(empPage, /email-n/);
assert.match(empPage, /push-n/);
assert.doesNotMatch(empPage, /emailNotifications:/);

const mobileNotif = read("mobile/features/settings/sections/NotificationsSettingsSection.tsx");
assert.doesNotMatch(mobileNotif, /summaryEmails/);
assert.doesNotMatch(mobileNotif, /emailNotifications/);
assert.match(mobileNotif, /tipReceivedNotifications/);
assert.match(mobileNotif, /pushNotifications/);

const en = JSON.parse(read("src/i18n/locales/en.json")) as {
  business: { accountSettings: Record<string, string> };
  employee: { settings: Record<string, string> };
  admin: { platformSettings: { notifications: Record<string, string> } };
};
assert.match(en.business.accountSettings.tipNotifDesc, /push/i);
assert.match(en.business.accountSettings.tipNotifDesc, /inbox/i);
assert.match(en.business.accountSettings.systemDesc, /push/i);
assert.match(en.business.accountSettings.loginDesc, /sign in/i);
assert.doesNotMatch(en.business.accountSettings.loginDesc, /new device signs in/i);
assert.match(en.employee.settings.pushNotifHint, /inbox/i);
assert.match(en.admin.platformSettings.notifications.desc, /sign-in email/i);

const trial = read("backend/src/services/trialReminderEmail.service.ts");
assert.match(trial, /runTrialReminderEmails/);
assert.doesNotMatch(trial, /summaryEmails/);

const orchestrator = read("backend/src/services/notifications/notificationOrchestrator.service.ts");
assert.match(orchestrator, /deliverUserNotification/);
assert.match(orchestrator, /createInboxNotification/);

console.log("notification-settings-phase2-runtime: ok");
