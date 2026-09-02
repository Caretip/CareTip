/**
 * Maps API/technical errors to user-friendly messages.
 * Technical details stay on the server; the UI only shows safe copy.
 */

import i18n from "../../i18n/i18n";
import {
  isApiRequestError,
  EMAIL_NOT_VERIFIED_CODE,
  GOOGLE_ACCOUNT_NOT_REGISTERED_CODE,
  OAUTH_ACCOUNT_NOT_REGISTERED_CODE,
  OAUTH_LINKING_REQUIRED_CODE,
  OAUTH_SIGN_IN_FAILED_CODE,
  OAUTH_EMAIL_REQUIRED_CODE,
  OAUTH_TOKEN_VERIFICATION_FAILED_CODE,
  PLAN_CAPABILITY_REQUIRED_CODE,
  PLAN_LIMIT_EXCEEDED_CODE,
  SUBSCRIPTION_REQUIRED_CODE,
} from "./apiError";
import { translateFriendlyMessageToDe } from "./friendlyMessageDe";

function localizeFriendlyMessageCopy(english: string): string {
  try {
    const lng = String(i18n.resolvedLanguage ?? i18n.language ?? "").toLowerCase();
    if (!lng.startsWith("de")) return english;
  } catch {
    return english;
  }
  return translateFriendlyMessageToDe(english);
}

/** Use only when the failure type cannot be determined (null/empty/unknown). */
export const GENERIC_UNKNOWN_ERROR = "Something went wrong. Please try again.";

/** Shown when auth/session refresh fails with HTTP 503 (matches product copy; avoids infinite retry loops). */
export const SERVICE_UNAVAILABLE_CLIENT_MESSAGE = "Service temporarily unavailable";

/** Cross-origin API unreachable after retry (e.g. Render cold start on free tier). */
export const API_WAKEUP_NETWORK_MESSAGE =
  "Unable to connect to the server. The API may still be waking up. Wait a few seconds and try again.";

/** True when the browser could not reach the CareTip API (offline, backend stopped, cold start). */
export function isApiConnectivityError(error: unknown): boolean {
  if (error == null) return false;
  if (isAbortError(error)) return false;
  if (isApiRequestError(error) && (error.status === 503 || error.status === 502 || error.status === 504)) {
    return true;
  }
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (!message.trim()) return false;
  const lower = message.toLowerCase();
  return (
    /failed to fetch|networkerror|load failed|network request failed|unable to connect to the server/i.test(
      lower,
    ) || /vite\.config\.ts|port 3001|npm run dev/i.test(lower)
  );
}

/** Fetch cancelled via AbortSignal (React effect cleanup, navigation, strict mode). */
export function isAbortError(error: unknown): boolean {
  if (error == null) return false;
  if (typeof error === "object" && "name" in error) {
    const name = (error as { name: unknown }).name;
    if (name === "AbortError") return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /operation was aborted|request aborted|aborted/i.test(message);
}

const ERROR_MAP: Record<string, string> = {
  // Auth
  "Email already registered":
    "We couldn't create your account with these details. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  "We couldn't invite this email. If they already have a CareTip account, ask them to sign in instead.":
    "We couldn't invite this email. If they already have a CareTip account, ask them to sign in instead.",
  "We couldn't create your account with these details. If you already have a CareTip account, please sign in or use Forgot Password to recover access.":
    "We couldn't create your account with these details. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  "This email is already in use. Try signing in or use a different email.":
    "We couldn't create your account with these details. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  "Invalid email or password": "Incorrect email or password. Please try again.",
  "Invalid or expired invite code": "This invite code is invalid or has expired. Ask your manager for a new code.",
  "Email and password are required": "Please enter your email and password.",
  "Business name is required": "Please enter your business name.",
  "Name is required": "Please enter your full name.",
  "Invite code is required": "Please enter your invite code.",
  "Invalid role. Use 'business' or 'employee'": "Please choose whether you're a business or staff member.",
  "intendedRole is required and must be 'business' or 'employee'":
    "Please choose whether you're signing in as a business or staff member.",
  "This account does not have Business permissions.":
    "This account is not registered as a business.",
  "This account does not have Staff permissions.":
    "This account is not registered as staff.",
  "This account does not have Super Admin permissions.":
    "Incorrect email or password. Please try again.",
  "Use the Platform Admin sign-in for this account.":
    "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  "We couldn't load dashboard stats. Please try again in a moment.":
    "We couldn't load dashboard stats. Please try again in a moment.",
  "Unable to load stats": "We couldn't load dashboard stats. Please try again in a moment.",
  "STATS_FETCH_ERROR": "We couldn't load dashboard stats. Please try again in a moment.",
  "We couldn't save your venue or team data. Please try again.":
    "We couldn't load dashboard data. Please try again in a moment.",
  "Registration failed": "We couldn't create your account. Please try again.",
  "Login failed": "We couldn't sign you in. Please check your email and password.",
  "We couldn't create your account. Please try again.":
    "We couldn't create your account. Please try again.",
  "Sign-in is temporarily unavailable. Please try again in a few moments.":
    "Sign-in isn't available right now. Please try again in a few minutes.",
  "Sign-in service is temporarily unavailable. Please try again shortly.":
    "Sign-in isn't available right now. Please try again in a few minutes.",
  "This account uses Google sign-in.": "Incorrect email or password. Please try again.",
  "Password sign-in is not set for this account. Use Google.":
    "Incorrect email or password. Please try again.",
  "This account uses social sign-in. Continue with Google, Apple, or Facebook.":
    "Incorrect email or password. Please try again.",
  [OAUTH_SIGN_IN_FAILED_CODE]:
    "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  [OAUTH_LINKING_REQUIRED_CODE]:
    "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  [OAUTH_EMAIL_REQUIRED_CODE]:
    "Facebook did not provide an email address. Enable email permission in Facebook Login, or use another sign-in method.",
  [OAUTH_TOKEN_VERIFICATION_FAILED_CODE]:
    "Social sign-in could not be verified. Please try again.",
  [OAUTH_ACCOUNT_NOT_REGISTERED_CODE]:
    "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  [GOOGLE_ACCOUNT_NOT_REGISTERED_CODE]:
    "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.":
    "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  "Unable to link this social account.": "Unable to link this social account.",
  "This social account is already linked to another CareTip user.": "Unable to link this social account.",
  "This account has been disabled.": "Incorrect email or password. Please try again.",
  "Email is already verified.": "If verification is needed for this account, we sent a link.",
  "We sent a new verification link to your email.": "We sent a new verification link. Check your inbox (and spam).",
  "If verification is needed for this account, we sent a link.":
    "If verification is needed for this account, we sent a link.",
  "Verification link is invalid or has expired.": "This link has expired. Request a new one.",
  "Verification token is required": "This link has expired. Request a new one.",
  "Email verification required": "Please verify your email using the link we sent you.",
  "Restart the Caretip API after editing .env. JWT_SECRET is only loaded when the backend starts. Stop it (Ctrl+C) and run npm run dev again.":
    "Sign-in isn’t working on the server right now. If you manage the app, restart the API after setting JWT_SECRET.",
  // Legacy keys
  "Server is currently unavailable. Please try again in a moment.":
    "The app is temporarily unavailable. Please try again in a moment.",

  // Password validation
  "Current and new password are required": "Please enter your current password and a new password.",
  "Current password is incorrect": "That current password doesn't match our records. Please try again.",
  "User not found": "We couldn't find your account. Please sign in again.",
  "Password is required": "Please enter a password.",
  "Password must be at least 8 characters": "Your password needs to be at least 8 characters long.",
  "Password must contain at least one uppercase letter": "Your password needs at least one uppercase letter (A to Z).",
  "Password must contain at least one lowercase letter": "Your password needs at least one lowercase letter (a to z).",
  "Password must contain at least one number": "Your password needs at least one number (0 to 9).",
  "Password must contain at least one special character (e.g. @, #, $, %)":
    "Your password needs at least one special character (e.g. @, #, $, %).",

  // Business / Invite
  "Only business owners can generate invite codes.": "Only business owners can generate invite codes.",
  "Failed to generate invite code.": "We couldn't create an invite code. Please try again in a moment.",

  // Auth (session/token)
  "Authentication required": "Please sign in to continue.",
  "Invalid or expired token": "Your session has expired. Please sign in again.",
  "Insufficient permissions": "You don't have permission to do this.",

  // Business / employees
  "Only business owners can add employees": "Only business owners can add employees.",
  "Only business owners can update employees": "Only business owners can update staff.",
  "Only business owners can remove employees": "Only business owners can remove staff.",
  "Name, email, and role are required": "Please enter name, email, and role for this team member.",
  "Email already in use": "That email is already used by another team member.",
  "Name cannot be empty": "Name can't be empty.",
  "Update failed": "We couldn't save those changes. Please try again.",

  // Business / data
  "Business not found": "We couldn't find this business.",
  "businessId is required": "We’re missing your business context. Open this from your dashboard and try again.",
  "Profile not found": "We couldn't load your profile. Please try again.",
  "Staff member not found": "We couldn't find that team member.",
  "Employee not found": "We couldn't find that team member.",
  "Slug is required": "Please enter a valid link or code.",
  "Employee ID is required": "We’re missing which team member this refers to. Please try again.",

  // QR / KYC (business managers — employees see audience-specific copy in {@link toUserFriendlyMessage})
  "QR code will be available after business verification.":
    "Your business verification is still in progress. QR codes can be generated after your onboarding has been approved.",
  "QR code generation will be enabled after admin verification.":
    "Your business verification is still in progress. QR codes can be generated after your onboarding has been approved.",
  "Your business verification is still in progress. QR codes can be generated after your onboarding has been approved.":
    "Your business verification is still in progress. QR codes can be generated after your onboarding has been approved.",

  // Locations / tables
  "Location name is required": "Please enter a location name.",
  "Table name is required": "Please enter a table name.",
  "name and locationId are required": "Please enter a table name and choose a location.",
  "name is required": "Please enter a name.",
  "Location not found": "We couldn't find that location.",
  "Table not found": "We couldn't find that table.",
  "Table not found for this code": "We couldn't find a table for this QR code. Check the link or ask your venue for an updated code.",
  "locationId is required": "Please open a valid venue or table link.",
  "tableId is required": "Please open a valid table link.",
  "qrSlug is required": "Please scan a valid QR code or open a valid link.",
  "Invalid location": "That location doesn’t belong to your venue or doesn’t exist.",
  "One or more tables are invalid": "One or more selected tables aren’t valid.",
  "Table does not belong to this business": "That table doesn’t belong to your venue.",
  "Selected tables must belong to a single location": "Pick tables from one location only.",
  "Selected tables must belong to the assigned location": "Those tables must match the selected location.",
  "This QR slug is already in use": "That QR code ID is already taken. Pick another or leave it blank to auto-generate.",
  "Could not generate a unique QR slug": "We couldn't generate a unique code for this table. Try again in a moment.",
  "qrSlug must be 3–128 characters: letters, numbers, hyphens, underscores":
    "Custom QR codes can only use letters, numbers, hyphens, and underscores (3 to 128 characters).",

  // Payment / tips
  CONNECT_NOT_READY: "This venue cannot accept tips right now.",
  STRIPE_ACCOUNT_CREATE_FAILED: "Stripe connection couldn't be started. Please try again.",
  STRIPE_ACCOUNT_RETRIEVE_FAILED: "Stripe connection couldn't be started. Please try again.",
  STRIPE_ACCOUNT_TENANT_CONFLICT: "Stripe connection couldn't be started. Please try again.",
  STRIPE_ACCOUNT_LINK_FAILED: "Stripe connection couldn't be started. Please try again.",
  STRIPE_ACCOUNT_LINK_EMPTY: "Stripe connection couldn't be started. Please try again.",
  STRIPE_ACCOUNT_PERSIST_FAILED: "Stripe connection couldn't be started. Please try again.",
  "Stripe connection couldn't be started. Please try again.":
    "Stripe connection couldn't be started. Please try again.",
  "Could not start Stripe Connect setup. Please try again later.":
    "Stripe connection couldn't be started. Please try again.",
  "Could not open Stripe onboarding. Please try again.":
    "Stripe connection couldn't be started. Please try again.",
  "Could not save Stripe Connect account. Please try again.":
    "Stripe connection couldn't be started. Please try again.",
  CONNECT_DESTINATION_MISMATCH: "This venue cannot accept tips right now.",
  CONNECT_PAYMENT_INVARIANT: "This venue cannot accept tips right now.",
  CONNECT_LIVE_ACCOUNT_NOT_CAPABLE: "This venue cannot accept tips right now.",
  "This venue cannot accept tips right now.": "This venue cannot accept tips right now.",
  "amount, employeeId, and businessId are required": "Please complete your tip details and try again.",
  "employeeId and businessId are required": "Please choose who you’re tipping and try again.",
  "amount must be a positive number": "Please enter a tip amount greater than zero.",
  "Invalid amount": "Please enter a valid tip amount.",
  "Payment processing is not configured yet.":
    "Tipping isn’t turned on for this environment yet. The venue needs to finish payment setup.",
  "Stripe payment processing is not configured": "Payments aren’t set up yet. The venue needs to connect Stripe.",
  "We couldn't start the payment. Please try again.": "We couldn't start the payment. Please try again.",
  "We couldn't complete that request. Please try again.":
    "We couldn't save your changes. Please refresh and try again.",
  "We couldn't update your password. Please try again.": "We couldn't update your password. Please try again.",
  "We couldn't upload your photo. Please try again.": "We couldn't upload your photo. Please try again.",
  "We couldn't export your data. Please try again.": "We couldn't export your data. Please try again.",
  "We couldn't delete your account. Please try again.": "We couldn't delete your account. Please try again.",
  "We couldn't find this business.": "We couldn't find this business.",
  "Invalid amount or business context": "That tip amount or business details aren’t valid. Please try again.",
  "Invalid tip amount": "Please enter a valid tip amount.",
  "Amount too small": "That amount is too small for a tip. Please enter a larger amount.",
  "Payment provider could not start checkout": "Checkout couldn’t be started. Please try again or use another card.",
  "sessionId is required": "We’re missing your payment session. Go back to checkout or open the link from your receipt.",
  "Could not verify payment session.": "We couldn't confirm that payment session. If you just paid, wait a moment and try again.",
  "Please add a rating or a short note.": "Add a star rating or a short note, or leave the page if you prefer not to.",
  "rating must be between 1 and 5": "Please choose a rating from 1 to 5 stars.",
  "comment is too long": "That note is too long. Please shorten it and try again.",
  "We couldn't save your feedback. Please try again.": "We couldn't save your feedback. Please try again.",

  // Staff goals
  "goalAmount, goalPeriod, and startDate are required": "Please enter goal amount, period, and start date.",
  "goalAmount must be a non-negative number": "Goal amount must be zero or more.",
  "goalPeriod must be daily, weekly, or monthly": "Choose daily, weekly, or monthly for your goal.",
  "startDate must be YYYY-MM-DD": "Use a start date like 2026-01-15.",

  // Platform admin uploads
  "id is required": "Please refresh the page and try again. Something was missing from that request.",
  "File is required (multipart field name: file)": "Please choose a file to upload.",

  // OAuth / signup
  "Invite code is required for staff sign-up.": "Enter the invite code from your manager to join as staff.",
  "Email already registered. Sign in instead.":
    "We couldn't create your account with these details. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
  "Google did not return an email for this account.": "Google didn’t share an email for this account. Try another Google account or contact support.",

  "Not allowed": "You’re not allowed to do that with your current account.",

  // Network / generic transport
  "The request body was not valid JSON. Send a JSON object (for example {\"email\":\"...\",\"password\":\"...\"}) with Content-Type: application/json.":
    "The request was not valid. Please try again or refresh the page.",
  "Failed to fetch": "Unable to connect to the server. Check your connection and try again.",
  "NetworkError": "Unable to connect to the server. Check your connection and try again.",
  "Load failed": "Unable to connect to the server. Check your connection and try again.",
  [API_WAKEUP_NETWORK_MESSAGE]: API_WAKEUP_NETWORK_MESSAGE,
  "Aborted": "The request was cancelled. Please try again.",

  // Storage / uploads (server sends these exact strings)
  "We couldn't save your file. Please try again.": "We couldn't save your file. Please try again.",
  "We couldn't confirm the upload. Please try again.": "We couldn't confirm the upload. Please try again.",
  "We couldn't complete the upload. Please try again.": "We couldn't complete the upload. Please try again.",
  "File upload isn't available right now. Please try again later.":
    "File upload isn't available right now. Please try again later.",
  "This feature is temporarily unavailable. Please try again in a few minutes.":
    "This feature is temporarily unavailable. Please try again in a few minutes.",
  "We couldn't verify payment setup. Please try again.":
    "We couldn't verify payment setup. Please try again.",
  "We couldn't upload your logo. Please try again.": "We couldn't upload your logo. Please try again.",
  "We couldn't save your logo. Please try again.": "We couldn't save your logo. Please try again.",
  "We couldn't save your verification file. Please try again.":
    "We couldn't save your verification file. Please try again.",
  "Logo upload timed out. Try again with a smaller image.":
    "Logo upload timed out. Try again with a smaller image.",
  "The service is temporarily unavailable. Please try again later.":
    "The service is temporarily unavailable. Please try again later.",
};

const EMPLOYEE_QR_BUSINESS_KYC_HINT =
  "Your account is active. QR management is handled by your business.";

export type FriendlyMessageAudience = "business" | "employee";

export interface ToUserFriendlyMessageOptions {
  /** When set to `employee`, business-KYC / manager QR lock messages are rewritten for staff context. */
  audience?: FriendlyMessageAudience;
}

/** HTTP status → user message when the response body has no `message` field */
const STATUS_MESSAGES: Record<number, string> = {
  400: "That request wasn’t valid. Check your details and try again.",
  401: "Please sign in to continue.",
  403: "You don't have permission to do this.",
  404: "We couldn't find what you're looking for.",
  408: "The request took too long. Please try again.",
  409: "This couldn’t be completed yet. Try again in a moment.",
  422: "The information you entered isn't valid. Please check and try again.",
  429: "Too many requests. Please wait a moment and try again.",
  500: "Our servers hit a problem. Please try again in a few minutes.",
  502: "Our servers are temporarily unavailable. Please try again in a few minutes.",
  503: SERVICE_UNAVAILABLE_CLIENT_MESSAGE,
  504: "The request took too long. Please try again.",
};

const STATUS_MESSAGE_VALUES = new Set(Object.values(STATUS_MESSAGES));

/** Used by the API client when building an error string before a single pass through {@link toUserFriendlyMessage}. */
export function fallbackMessageForHttpStatus(status: number): string | undefined {
  return STATUS_MESSAGES[status];
}

/**
 * Converts any error (API, fetch, thrown) into a user-friendly message.
 */
export function toUserFriendlyMessage(error: unknown, options?: ToUserFriendlyMessageOptions): string {
  if (error == null) return localizeFriendlyMessageCopy(GENERIC_UNKNOWN_ERROR);
  if (isAbortError(error)) return "";

  if (
    isApiRequestError(error) &&
    (error.code === OAUTH_SIGN_IN_FAILED_CODE ||
      error.code === GOOGLE_ACCOUNT_NOT_REGISTERED_CODE ||
      error.code === OAUTH_ACCOUNT_NOT_REGISTERED_CODE ||
      error.code === OAUTH_LINKING_REQUIRED_CODE)
  ) {
    return localizeFriendlyMessageCopy(
      ERROR_MAP[OAUTH_SIGN_IN_FAILED_CODE] ??
        "We couldn't complete social sign-in. If you already have a CareTip account, please sign in or use Forgot Password to recover access.",
    );
  }

  if (isApiRequestError(error) && error.code === EMAIL_NOT_VERIFIED_CODE) {
    return error.message;
  }

  if (isApiRequestError(error) && error.code === SUBSCRIPTION_REQUIRED_CODE) {
    return localizeFriendlyMessageCopy(
      error.message?.trim() || "An active subscription is required to use this feature.",
    );
  }

  if (isApiRequestError(error) && error.code === PLAN_CAPABILITY_REQUIRED_CODE) {
    return localizeFriendlyMessageCopy(
      error.message?.trim() || "This feature is available on Pro.",
    );
  }

  if (isApiRequestError(error) && error.code === PLAN_LIMIT_EXCEEDED_CODE) {
    return localizeFriendlyMessageCopy(
      error.message?.trim() || "You've reached a limit on your current plan.",
    );
  }

  if (isApiRequestError(error) && error.code && ERROR_MAP[error.code]) {
    return localizeFriendlyMessageCopy(ERROR_MAP[error.code]);
  }

  const resolved = ((): string => {
    const message = error instanceof Error ? error.message : String(error);

    const normalized = message.trim();
    if (!normalized) return GENERIC_UNKNOWN_ERROR;

    // Never leak ORM/database internals to the UI.
    // Examples: "Could not save (P2010). Try again or run migrations in the backend."
    // Keep the real error in logs (handled elsewhere), but show safe product copy here.
    const lower = normalized.toLowerCase();
    if (
      /\bP\d{4}\b/.test(normalized) ||
      lower.includes("prisma") ||
      lower.includes("run migrations") ||
      lower.includes("prismaclient") ||
      lower.includes("raw query failed")
    ) {
      return "We couldn't load that data right now. Please try again in a moment.";
    }

    if (options?.audience === "employee") {
      if (
        lower.includes("qr code will be available after business verification") ||
        lower.includes("qr code generation will be enabled after admin verification") ||
        lower.includes("unlock after your venue is verified") ||
        lower.includes("after your venue is verified by caretip")
      ) {
        return EMPLOYEE_QR_BUSINESS_KYC_HINT;
      }
    }

    const mapped = ERROR_MAP[normalized];
    if (mapped) return mapped;

    if (
      /\bprismaclient\w*/i.test(normalized) ||
      /\bjwt\b/i.test(lower) ||
      lower.includes("jsonwebtoken") ||
      lower.includes("unauthorizedexception") ||
      lower.includes("stack trace") ||
      lower.includes("supabase") ||
      (lower.includes("stripe") && lower.includes("invalid")) ||
      lower.includes("internal server error") ||
      lower.includes("econnrefused") ||
      lower.includes("enetunreach") ||
      (lower.includes("at ") && /\.(ts|js|tsx|jsx):\d+/i.test(normalized))
    ) {
      return GENERIC_UNKNOWN_ERROR;
    }

    if (Object.values(ERROR_MAP).includes(normalized)) {
      return normalized;
    }

    /** Preserves messages already produced by {@link fallbackMessageForHttpStatus} (api.ts handleRes). */
    if (STATUS_MESSAGE_VALUES.has(normalized)) {
      return normalized;
    }

    const requestFailedMatch = normalized.match(/^Request failed \((\d{3})\)$/);
    if (requestFailedMatch) {
      const code = parseInt(requestFailedMatch[1], 10);
      const byCode = STATUS_MESSAGES[code];
      if (byCode) return byCode;
    }

    if (/^(502|503|504)\s|Bad Gateway|Gateway Timeout|Service Unavailable/i.test(normalized)) {
      if (/502|Bad Gateway/i.test(normalized)) return STATUS_MESSAGES[502]!;
      if (/504|Gateway Timeout/i.test(normalized)) return STATUS_MESSAGES[504]!;
      if (/503|Service Unavailable/i.test(normalized)) return STATUS_MESSAGES[503]!;
    }

    const statusMatch = normalized.match(/^(\d{3})/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      const statusMsg = STATUS_MESSAGES[status];
      if (statusMsg) return statusMsg;
    }

    if (
      normalized.includes("Failed to fetch") ||
      normalized === "Load failed" ||
      normalized === "NetworkError" ||
      normalized.includes("NetworkError when attempting to fetch") ||
      /failed to load|networkerror|load failed|econnrefused|err_connection_refused|err_network_changed/i.test(
        normalized,
      )
    ) {
      return ERROR_MAP["Failed to fetch"]!;
    }

    if (/network request failed|fetch failed|the network connection was lost|timeout/i.test(normalized)) {
      return ERROR_MAP["Failed to fetch"]!;
    }

    if (
      /database|prisma|sql|postgres|can't reach database|invocation:|error occurred during query|connectorerror/i.test(
        normalized,
      )
    ) {
      return "We couldn't load data right now. Please try again in a few minutes.";
    }

    return GENERIC_UNKNOWN_ERROR;
  })();

  return localizeFriendlyMessageCopy(resolved);
}
