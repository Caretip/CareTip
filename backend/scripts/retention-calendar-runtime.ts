/**
 * Calendar-year retention math — no database.
 * Run: npm run test:retention-calendar (from backend/)
 */
import {
  addUtcDays,
  addUtcHours,
  calendarYearInTimeZone,
  calendarYearRetentionEligibleAt,
  hoursCutoff,
  isCalendarYearRetentionElapsed,
} from "../src/services/retentionCalendar.js";
import {
  ACCOUNT_ERASURE_GRACE_DAYS,
  AUDIT_RETENTION_YEARS,
  DELETION_CANCELLATION_DAYS,
  FINANCIAL_RETENTION_YEARS,
  NOTIFICATION_RETENTION_DAYS,
  QR_PERSONAL_ANONYMIZATION_HOURS,
  SUPPORT_RETENTION_YEARS,
} from "../src/services/retentionPolicy.constants.js";
import { userErasurePendingData } from "../src/services/lifecycleStatus.helpers.js";

const results: string[] = [];
const pass = (m: string) => results.push(`PASS: ${m}`);
const fail = (m: string) => results.push(`FAIL: ${m}`);

function iso(d: Date) {
  return d.toISOString();
}

function main() {
  const event = new Date("2026-08-15T12:00:00.000Z");
  const fin = calendarYearRetentionEligibleAt(event, FINANCIAL_RETENTION_YEARS, "UTC");
  if (fin.ok && iso(fin.eligibleAt) === "2037-01-01T00:00:00.000Z" && fin.calendarYear === 2026) {
    pass("financial 10y: 2026-08-15 → eligible 2037-01-01 UTC");
  } else fail(`financial example: ${JSON.stringify(fin)}`);

  const support = calendarYearRetentionEligibleAt(event, SUPPORT_RETENTION_YEARS, "UTC");
  if (support.ok && iso(support.eligibleAt) === "2030-01-01T00:00:00.000Z") {
    pass("support 3y: closed 2026-08-15 → eligible 2030-01-01 UTC");
  } else fail(`support example: ${JSON.stringify(support)}`);

  const audit = calendarYearRetentionEligibleAt(event, AUDIT_RETENTION_YEARS, "UTC");
  if (audit.ok && iso(audit.eligibleAt) === "2030-01-01T00:00:00.000Z") {
    pass("audit 3y calendar-year");
  } else fail("audit years");

  const jan1 = calendarYearRetentionEligibleAt(new Date("2026-01-01T00:00:00.000Z"), 10, "UTC");
  const dec31 = calendarYearRetentionEligibleAt(new Date("2026-12-31T23:59:59.999Z"), 10, "UTC");
  if (jan1.ok && dec31.ok && iso(jan1.eligibleAt) === iso(dec31.eligibleAt)) {
    pass("Jan 1 and Dec 31 of same UTC year share eligibility instant");
  } else fail("year-end pair");

  const leap = calendarYearRetentionEligibleAt(new Date("2024-02-29T12:00:00.000Z"), 10, "UTC");
  if (leap.ok && leap.calendarYear === 2024 && iso(leap.eligibleAt) === "2035-01-01T00:00:00.000Z") {
    pass("leap day 2024-02-29 → year 2024 → 2035-01-01");
  } else fail(`leap: ${JSON.stringify(leap)}`);

  const berlinNewYear = calendarYearInTimeZone(new Date("2026-12-31T23:30:00.000Z"), "Europe/Berlin");
  const utcNewYear = calendarYearInTimeZone(new Date("2026-12-31T23:30:00.000Z"), "UTC");
  if (berlinNewYear.ok && berlinNewYear.year === 2027 && utcNewYear.ok && utcNewYear.year === 2026) {
    pass("timezone boundary: 2026-12-31 23:30Z is 2027 in Europe/Berlin and 2026 in UTC");
  } else fail(`tz boundary berlin=${JSON.stringify(berlinNewYear)} utc=${JSON.stringify(utcNewYear)}`);

  const invalidTz = calendarYearRetentionEligibleAt(event, 10, "Not/AZone");
  if (!invalidTz.ok && invalidTz.reason === "invalid_timezone") {
    pass("invalid timezone fail-closed");
  } else fail("invalid tz should fail closed");

  const elapsed = isCalendarYearRetentionElapsed(event, 10, new Date("2037-01-01T00:00:00.000Z"), "UTC");
  const notElapsed = isCalendarYearRetentionElapsed(event, 10, new Date("2036-12-31T23:59:59.000Z"), "UTC");
  if (elapsed.elapsed && !notElapsed.elapsed) {
    pass("elapsed exactly at exclusive 1 Jan boundary");
  } else fail("elapsed boundary");

  const now = new Date("2026-08-15T00:00:00.000Z");
  const pending = userErasurePendingData(now);
  const cancelMs = pending.deletionCancelUntil.getTime() - now.getTime();
  const eligibleMs = pending.anonymizeEligibleAt.getTime() - now.getTime();
  if (
    cancelMs === DELETION_CANCELLATION_DAYS * 86400000 &&
    eligibleMs === ACCOUNT_ERASURE_GRACE_DAYS * 86400000 &&
    DELETION_CANCELLATION_DAYS !== ACCOUNT_ERASURE_GRACE_DAYS
  ) {
    pass("14-day cancel and 30-day anonymize eligibility are distinct clocks");
  } else fail("14/30 clocks merged or wrong");

  const qrCut = hoursCutoff(QR_PERSONAL_ANONYMIZATION_HOURS, now);
  if (now.getTime() - qrCut.getTime() === QR_PERSONAL_ANONYMIZATION_HOURS * 3600000) {
    pass("QR personal anonymization cutoff is 48 hours");
  } else fail("48h cutoff");

  const n90 = addUtcDays(now, NOTIFICATION_RETENTION_DAYS);
  if (n90.getTime() - now.getTime() === 90 * 86400000) {
    pass("notification retention is 90 UTC days");
  } else fail("90d");

  const plus14 = addUtcDays(now, 14);
  const plus30 = addUtcHours(now, 30 * 24);
  if (plus14.toISOString() === "2026-08-29T00:00:00.000Z" && plus30.toISOString() === "2026-09-14T00:00:00.000Z") {
    pass("addUtcDays/Hours around August 2026");
  } else fail(`add helpers ${plus14.toISOString()} ${plus30.toISOString()}`);

  const rollingWrong = new Date(now.getTime() - 10 * 365 * 86400000);
  if (fin.ok && rollingWrong.getTime() !== fin.eligibleAt.getTime()) {
    pass("calendar-year eligibility is not now-3650d");
  } else fail("must not equal rolling 3650 days");

  const failed = results.filter((r) => r.startsWith("FAIL"));
  for (const line of results) console.log(line);
  console.log(`\nRetention calendar: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main();
