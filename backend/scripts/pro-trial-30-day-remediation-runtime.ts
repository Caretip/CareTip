/**
 * Pro trial 30-day + reminder remediation locks (no live Stripe / no email send).
 * Run: npm run test:pro-trial-30-day --prefix backend
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SUBSCRIPTION_TRIAL_PERIOD_DAYS } from "../src/config/subscriptionTrial.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return readFileSync(abs, "utf8");
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

assert(
  !process.env.STRIPE_TRIAL_PERIOD_DAYS?.trim() ||
    Number.parseInt(process.env.STRIPE_TRIAL_PERIOD_DAYS, 10) === 30,
  "when STRIPE_TRIAL_PERIOD_DAYS is set in this process it must be 30 for this lock",
);
assert(
  SUBSCRIPTION_TRIAL_PERIOD_DAYS === 30,
  `SUBSCRIPTION_TRIAL_PERIOD_DAYS must be 30, got ${SUBSCRIPTION_TRIAL_PERIOD_DAYS}`,
);

const trialCfg = read("backend/src/config/subscriptionTrial.ts");
assert(trialCfg.includes(": 30"), "subscriptionTrial fallback default must be 30");
assert(!/: 28/.test(trialCfg), "subscriptionTrial must not default to 28");

const billing = read("backend/src/services/stripeBilling.service.ts");
assert(billing.includes("trial_period_days: SUBSCRIPTION_TRIAL_PERIOD_DAYS"), "checkout still uses trial_period_days");
assert(billing.includes('payment_method_collection: "always"'), "PM collection always preserved");
assert(billing.includes("automatic_tax: { enabled: true }"), "Stripe Tax remains enabled with trial checkout");
assert(billing.includes("tax_id_collection: { enabled: true }"), "tax ID collection preserved with trial");
assert(billing.includes("custom_text"), "trial checkout adds Stripe custom_text.submit");
assert(billing.includes("30-day free Pro trial"), "Stripe submit text mentions 30-day trial");
assert(billing.includes('params.planKey === "premium"'), "trial remains Pro-only");

const reminder = read("backend/src/services/trialReminderEmail.service.ts");
assert(reminder.includes('REMINDER_DAYS: TrialReminderDay[] = ["7", "3", "1"]'), "7/3/1 reminders preserved");
assert(reminder.includes("cancelAtPeriodEnd: false"), "cancelled-at-period-end trials skipped");
assert(reminder.includes("trialReminderSent"), "idempotency field preserved");
assert(reminder.includes("try {"), "per-subscription try/catch for failure isolation");
assert(reminder.includes("sendLocalizedUserNotificationEmail"), "Resend notification path preserved");

const jobs = read("backend/src/routes/internalJobs.routes.ts");
assert(jobs.includes('router.post("/trial-reminders"'), "trial-reminders job route exists");
assert(jobs.includes("x-cron-secret"), "cron secret header gate preserved");
assert(jobs.includes("runTrialReminderEmails"), "job still calls existing reminder service");

const render = read("render.yaml");
assert(render.includes("caretip-trial-reminders"), "Render cron for trial reminders present");
assert(render.includes("/api/internal/jobs/trial-reminders"), "cron path targets trial-reminders");
assert(render.includes('"0 7 * * *"'), "daily schedule present");
assert(render.includes("caretip-category-retention-sweep"), "existing retention crons preserved");

const dialog = read("src/app/components/business/settings/billing/BillingTrialSection.tsx");
assert(dialog.includes("firstChargeNote"), "checkout dialog shows first-charge disclosure");
assert(dialog.includes("trialPaymentNote"), "checkout dialog keeps payment/conversion note");
assert(dialog.includes("includeTrial: true"), "dialog still starts Pro trial checkout");

const en = read("src/i18n/locales/en.json");
const de = read("src/i18n/locales/de.json");
assert(en.includes("Start 30-day free trial"), "EN CTA uses 30-day");
assert(en.includes("First payment: charged when the 30-day trial ends"), "EN first-charge note");
assert(!/4-week free Pro trial|Start 4 Week Free Trial|Start 4-Week Pro Trial/.test(en), "EN Pro trial copy must not say 4-week");
assert(de.includes("30 Tage kostenlos testen"), "DE CTA uses 30 Tage");
assert(de.includes("Erste Zahlung: am Ende der 30-Tage-Testphase"), "DE first-charge note");
assert(!/4-wöchige Pro-Testphase|4-Wochen-Pro-Test starten|4 Wochen kostenlos testen/.test(de), "DE Pro trial copy must not say 4 Wochen");

const webhook = read("backend/src/services/stripeBillingWebhook.service.ts");
assert(webhook.includes("invoice.payment_failed"), "payment failure webhook preserved");
assert(webhook.includes("customer.subscription.updated"), "subscription update webhook preserved");

console.log("pro-trial-30-day-remediation-runtime: ok");
