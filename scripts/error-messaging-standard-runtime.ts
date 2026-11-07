/**
 * CareTip error-messaging standard: every user-facing error is plain, actionable and localized,
 * never technical; internal signals keep working for session handling; connectivity stays
 * classifiable whatever the display language. No backend, no network.
 */
import assert from "node:assert/strict";
import i18n from "../src/i18n/i18n";
import { ApiRequestError } from "../src/app/lib/apiError";
import {
  API_WAKEUP_NETWORK_MESSAGE,
  CONNECTIVITY_ERROR_FLAG,
  GENERIC_UNKNOWN_ERROR,
  NETWORK_UNAVAILABLE_MESSAGE,
  REQUEST_TIMEOUT_MESSAGE,
  SERVER_ERROR_MESSAGE,
  SERVICE_UNAVAILABLE_CLIENT_MESSAGE,
  TEMPORARILY_UNAVAILABLE_MESSAGE,
  fallbackMessageForHttpStatus,
  isApiConnectivityError,
  toDisplayErrorMessage,
  toUserFriendlyMessage,
  userFacingErrorCopy,
} from "../src/app/lib/errorMessages";
import { FRIENDLY_MESSAGE_DE, translateFriendlyMessageToDe } from "../src/app/lib/friendlyMessageDe";

let checks = 0;
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name);
  checks++;
};
const setLang = (l: "en" | "de") => {
  const x = i18n as unknown as { language?: string; resolvedLanguage?: string };
  x.language = l;
  x.resolvedLanguage = l;
};
const api = (message: string, status: number, code?: string) => new ApiRequestError(message, status, code);

/** Words that expose implementation details or blame infrastructure. */
const TECHNICAL = /\b(api|backend|waking|jwt|prisma|supabase|render|vite|localhost|port \d+|npm|stack|http \d{3}|econnrefused|undefined|null)\b/i;

const NEW_COPY = [
  GENERIC_UNKNOWN_ERROR,
  NETWORK_UNAVAILABLE_MESSAGE,
  TEMPORARILY_UNAVAILABLE_MESSAGE,
  REQUEST_TIMEOUT_MESSAGE,
  SERVER_ERROR_MESSAGE,
];

setLang("en");

// 1. Every HTTP status shows plain copy, in English and German.
const statuses = [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504];
for (const lang of ["en", "de"] as const) {
  setLang(lang);
  for (const status of statuses) {
    const shown = toUserFriendlyMessage(api("", status));
    ok(shown.trim().length > 0, `${lang} ${status} has copy`);
    ok(!TECHNICAL.test(shown), `${lang} ${status} is not technical: ${shown}`);
  }
}
setLang("en");

// 2. Status → the standard wording.
ok(toUserFriendlyMessage(api("", 500)) === SERVER_ERROR_MESSAGE, "500 → server error copy");
ok(toUserFriendlyMessage(api("", 502)) === TEMPORARILY_UNAVAILABLE_MESSAGE, "502 → temporarily unavailable");
ok(toUserFriendlyMessage(api("", 503)) === TEMPORARILY_UNAVAILABLE_MESSAGE, "503 → temporarily unavailable");
ok(toUserFriendlyMessage(api("", 504)) === REQUEST_TIMEOUT_MESSAGE, "504 → timeout copy");
ok(toUserFriendlyMessage(api("", 408)) === REQUEST_TIMEOUT_MESSAGE, "408 → timeout copy");
ok(toUserFriendlyMessage(new TypeError("Failed to fetch")) === NETWORK_UNAVAILABLE_MESSAGE, "network → connection copy");

// 3. Internal signals stay intact for session handling, but never reach users verbatim.
ok(fallbackMessageForHttpStatus(503) === SERVICE_UNAVAILABLE_CLIENT_MESSAGE, "503 signal unchanged for auth code");
ok(SERVICE_UNAVAILABLE_CLIENT_MESSAGE === "Service temporarily unavailable", "503 signal matches backend wire text");
ok(toUserFriendlyMessage(new Error(SERVICE_UNAVAILABLE_CLIENT_MESSAGE)) === TEMPORARILY_UNAVAILABLE_MESSAGE, "503 signal displays friendly copy");
ok(toUserFriendlyMessage(new Error(API_WAKEUP_NETWORK_MESSAGE)) === NETWORK_UNAVAILABLE_MESSAGE, "wake-up signal displays connection copy");
ok(userFacingErrorCopy(SERVICE_UNAVAILABLE_CLIENT_MESSAGE) === TEMPORARILY_UNAVAILABLE_MESSAGE, "toast helper maps the 503 signal");
ok(!TECHNICAL.test(toUserFriendlyMessage(new Error(API_WAKEUP_NETWORK_MESSAGE))), "no 'API waking up' wording");

// 4. Connectivity stays classifiable after display copy is re-thrown, in either language.
for (const lang of ["en", "de"] as const) {
  setLang(lang);
  const shown = toUserFriendlyMessage(new TypeError("Failed to fetch"));
  const rethrown = Object.assign(new Error(shown), { [CONNECTIVITY_ERROR_FLAG]: true });
  ok(isApiConnectivityError(rethrown), `${lang} flagged re-throw is connectivity`);
  ok(isApiConnectivityError(new Error(shown)), `${lang} connection copy is connectivity without the flag`);
  const notNetwork = Object.assign(new Error(shown), { [CONNECTIVITY_ERROR_FLAG]: false });
  ok(!isApiConnectivityError(notNetwork), `${lang} explicit non-connectivity respected`);
}
setLang("en");

// 5. Screens that used to show raw API text.
ok(toDisplayErrorMessage(api("Order cannot be cancelled once printing has started.", 409), "FB") ===
  "Order cannot be cancelled once printing has started.", "business-rule 4xx sentence kept");
{
  const shown = toDisplayErrorMessage(api("PrismaClientKnownRequestError P2002", 400), "FB");
  ok(!/prisma|P2002/i.test(shown) && !TECHNICAL.test(shown), `Prisma internals never shown: ${shown}`);
}
ok(toDisplayErrorMessage(api("HTTP 500", 500), "FB") === SERVER_ERROR_MESSAGE, "5xx → server copy");
ok(toDisplayErrorMessage(api("Request failed (418)", 418), "FB") === "FB", "transport text → fallback");
ok(toDisplayErrorMessage(new TypeError("Failed to fetch"), "FB") === NETWORK_UNAVAILABLE_MESSAGE, "network → connection copy");
ok(toDisplayErrorMessage(api("Business not found", 404), "FB") === "We couldn't find this business.", "mapped copy wins");
ok(toDisplayErrorMessage(new DOMException("x", "AbortError"), "FB") === "FB", "abort → fallback, never 'aborted'");

// 6. German: every new message has natural German copy and survives a second pass.
for (const en of NEW_COPY) {
  const de = FRIENDLY_MESSAGE_DE[en];
  ok(typeof de === "string" && de !== en && de.length > 0, `German copy for: ${en}`);
  ok(!TECHNICAL.test(de), `German copy is not technical: ${de}`);
}
setLang("de");
ok(toUserFriendlyMessage(api("", 503)) === translateFriendlyMessageToDe(TEMPORARILY_UNAVAILABLE_MESSAGE), "DE 503");
const deNet = toUserFriendlyMessage(new TypeError("Failed to fetch"));
ok(toUserFriendlyMessage(new Error(deNet)) === deNet, "DE copy stable on second pass");
ok(!/API|Server startet/i.test(toUserFriendlyMessage(new Error(API_WAKEUP_NETWORK_MESSAGE))), "DE has no API wording");
setLang("en");

console.log(`error-messaging-standard-runtime: ok (${checks} checks)`);
