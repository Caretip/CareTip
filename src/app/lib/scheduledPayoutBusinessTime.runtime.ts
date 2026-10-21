/**
 * Scheduled payout display uses the business IANA zone, not the browser zone.
 * Run: npm run test:scheduled-payout-business-time
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatScheduledPayoutBusinessTime } from "./scheduledPayoutBusinessTime";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const BERLIN_INSTANT = "2026-10-21T07:00:00.000Z";

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function assertBerlinNine(viewerNote: string): void {
  const en = formatScheduledPayoutBusinessTime(BERLIN_INSTANT, "Europe/Berlin", "en");
  const de = formatScheduledPayoutBusinessTime(BERLIN_INSTANT, "Europe/Berlin", "de");
  assert.ok(en && de, viewerNote);
  assert.equal(en.instantIso, BERLIN_INSTANT, `${viewerNote} preserves instant`);
  assert.equal(de.instantIso, BERLIN_INSTANT);
  assert.equal(en.dateText, "21 October 2026", viewerNote);
  assert.equal(en.timeText, "09:00", viewerNote);
  assert.equal(en.formattedTimeZone, "Europe/Berlin");
  assert.equal(en.placeName, "Berlin");
  assert.equal(en.usesBusinessTimezone, true);
  assert.equal(de.dateText, "21. Oktober 2026");
  assert.equal(de.timeText, "09:00");
  assert.equal(de.placeName, "Berlin");

  const browser = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(BERLIN_INSTANT));
  assert.equal(en.timeText, "09:00", `${viewerNote} ignores browser clock ${browser}`);
}

if (process.env.SCHEDULED_PAYOUT_TZ_CHILD === "1") {
  assertBerlinNine(`viewer TZ ${process.env.TZ ?? "unset"}`);
  const browserHour = new Intl.DateTimeFormat("en-GB", {
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(BERLIN_INSTANT));
  if (process.env.TZ === "Africa/Lagos") {
    assert.match(browserHour, /08:00/, `Lagos browser would show 08:00, saw ${browserHour}`);
  }
  if (process.env.TZ === "Europe/Berlin") {
    assert.match(browserHour, /09:00/, `Berlin browser would show 09:00, saw ${browserHour}`);
  }
  process.exit(0);
}

const tsxCli = path.join(root, "backend/node_modules/tsx/dist/cli.mjs");
for (const tz of ["Africa/Lagos", "Europe/Berlin", "Pacific/Kiritimati"]) {
  const child = spawnSync(process.execPath, [tsxCli, fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ: tz, SCHEDULED_PAYOUT_TZ_CHILD: "1" },
    encoding: "utf8",
  });
  if (child.status !== 0) {
    throw new Error(
      `viewer ${tz} failed (${child.status})\n${child.stdout ?? ""}\n${child.stderr ?? ""}`,
    );
  }
}

const newYork = formatScheduledPayoutBusinessTime(
  "2026-10-21T13:00:00.000Z",
  "America/New_York",
  "en",
);
assert.ok(newYork);
assert.equal(newYork.instantIso, "2026-10-21T13:00:00.000Z");
assert.equal(newYork.dateText, "21 October 2026");
assert.equal(newYork.timeText, "09:00");
assert.equal(newYork.formattedTimeZone, "America/New_York");
assert.equal(newYork.placeName, "New York");

const lagosBusiness = formatScheduledPayoutBusinessTime(
  "2026-10-21T08:00:00.000Z",
  "Africa/Lagos",
  "en",
);
assert.ok(lagosBusiness);
assert.equal(lagosBusiness.timeText, "09:00");
assert.equal(lagosBusiness.placeName, "Lagos");
assert.equal(lagosBusiness.formattedTimeZone, "Africa/Lagos");

const summer = formatScheduledPayoutBusinessTime("2026-07-21T07:00:00.000Z", "Europe/Berlin", "en");
const winter = formatScheduledPayoutBusinessTime("2026-01-21T08:00:00.000Z", "Europe/Berlin", "en");
const springForward = formatScheduledPayoutBusinessTime(
  "2026-03-29T07:00:00.000Z",
  "Europe/Berlin",
  "de",
);
const fallBack = formatScheduledPayoutBusinessTime(
  "2026-10-25T08:00:00.000Z",
  "Europe/Berlin",
  "en",
);
assert.equal(summer?.timeText, "09:00");
assert.equal(summer?.dateText, "21 July 2026");
assert.equal(winter?.timeText, "09:00");
assert.equal(winter?.dateText, "21 January 2026");
assert.equal(springForward?.timeText, "09:00");
assert.equal(springForward?.dateText, "29. März 2026");
assert.equal(fallBack?.timeText, "09:00");
assert.equal(fallBack?.dateText, "25 October 2026");

for (const missing of [null, undefined, "", "   ", "Not/AZone", "Berlin"]) {
  const shown = formatScheduledPayoutBusinessTime(BERLIN_INSTANT, missing, "en");
  assert.ok(shown, String(missing));
  assert.equal(shown.instantIso, BERLIN_INSTANT);
  assert.equal(shown.usesBusinessTimezone, false);
  assert.equal(shown.formattedTimeZone, "UTC");
  assert.equal(shown.placeName, null);
  assert.equal(shown.timeText, "07:00");
  assert.equal(shown.dateText, "21 October 2026");
  assert.doesNotMatch(`${shown.placeName ?? ""} ${shown.formattedTimeZone}`, /Berlin/);
}

const trimmed = formatScheduledPayoutBusinessTime(BERLIN_INSTANT, "  Europe/Berlin  ", "en");
assert.equal(trimmed?.formattedTimeZone, "Europe/Berlin");
assert.equal(trimmed?.timeText, "09:00");

assert.equal(formatScheduledPayoutBusinessTime("not-a-date", "Europe/Berlin", "en"), null);

const en = JSON.parse(readFileSync(path.join(root, "src/i18n/locales/en.json"), "utf8")) as {
  employee: { payouts: { schedule: Record<string, string> } };
};
const de = JSON.parse(readFileSync(path.join(root, "src/i18n/locales/de.json"), "utf8")) as {
  employee: { payouts: { schedule: Record<string, string> } };
};
assert.equal(en.employee.payouts.schedule.nextPayoutLabel, "Next scheduled payout");
assert.equal(
  fill(en.employee.payouts.schedule.nextPayoutZone, { place: "Berlin", zone: "Europe/Berlin" }),
  "Berlin time (Europe/Berlin)",
);
assert.equal(
  en.employee.payouts.schedule.nextPayoutZoneUnavailable,
  "UTC (business timezone unavailable)",
);
assert.equal(de.employee.payouts.schedule.nextPayoutLabel, "Nächste geplante Auszahlung");
assert.equal(
  fill(de.employee.payouts.schedule.nextPayoutZone, { place: "Berlin", zone: "Europe/Berlin" }),
  "Berlin-Zeit (Europe/Berlin)",
);
assert.equal(
  de.employee.payouts.schedule.nextPayoutZoneUnavailable,
  "UTC (Zeitzone des Betriebs nicht verfügbar)",
);
assert.equal(
  fill(en.employee.payouts.schedule.nextPayoutZone, { place: "New York", zone: "America/New_York" }),
  "New York time (America/New_York)",
);

const card = readFileSync(
  path.join(root, "src/app/components/employee/EmployeeBankPayoutScheduleCard.tsx"),
  "utf8",
);
assert.match(card, /formatScheduledPayoutBusinessTime\(\s*data\.nextScheduledPayoutAt/);
assert.match(card, /data\.businessTimezone/);
assert.doesNotMatch(card, /toLocaleString/);
assert.doesNotMatch(card, /computeNextEvery3DaysPayoutAt/);

const scheduleService = readFileSync(
  path.join(root, "backend/src/services/employeeBankPayoutSchedule.service.ts"),
  "utf8",
);
assert.match(scheduleService, /businessTimezone: row\.employee\.business\.timezone/);
assert.match(scheduleService, /computeNextEvery3DaysPayoutAt\(\{\s*timezone: account\.employee\.business\.timezone/);

console.log("scheduled-payout-business-time: ok");
