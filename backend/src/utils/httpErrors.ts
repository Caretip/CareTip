import { Prisma } from "@prisma/client";
import { EntitlementDeniedError } from "../lib/subscription/entitlementHttpError.js";
import {
  AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
  AUTH_OAUTH_LINK_FAILED_MESSAGE,
  AUTH_REGISTER_GENERIC_MESSAGE,
} from "../services/authDisclosureMessages.js";

/** Messages intentionally thrown from services for end users (never stack traces / DB internals). */
const ALLOWED_CLIENT_MESSAGES = new Set<string>([
  // Validation
  "Email and password are required",
  "Current and new password are required",
  "Business name is required",
  "Name is required",
  "Invite code is required",
  "Invalid role. Use 'business' or 'employee'",
  "intendedRole is required and must be 'business' or 'employee'",
  "Monthly goal must be a non-negative number",
  "Image file is required (field name: avatar)",
  "Image file is empty.",
  "Image is too large (max 5 MB).",
  "Image file is too small or corrupted.",
  "Could not read this image. Try JPEG or PNG.",
  "Unsupported image type. Use JPEG, PNG, GIF, WebP, HEIC, or AVIF.",
  "Photo upload timed out. Please try again with a smaller image.",
  "Photo storage is not available. Please try again later.",
  "We couldn't upload your photo. Please try a JPEG or PNG under 5 MB.",
  "We couldn't save your file. Please try again.",
  "We couldn't confirm the upload. Please try again.",
  "We couldn't complete the upload. Please try again.",
  "File upload isn't available right now. Please try again later.",
  "This feature is temporarily unavailable. Please try again in a few minutes.",
  "Logo upload timed out. Try again with a smaller image.",
  "We couldn't save your logo. Please try again.",
  "We couldn't save your verification file. Please try again.",
  "Supabase storage returned no public URL (check bucket visibility).",
  "Unexpected upload field. Use the correct file field name.",
  "Logo must be an image (e.g. PNG, JPEG, WebP).",
  "businessId is required",
  "Employee ID is required",
  "amount, employeeId, and businessId are required",
  "Invalid amount",
  "Slug is required",
  // Password rules (passwordValidation.ts)
  "Password is required",
  "Password must be at least 8 characters",
  "Password must contain at least one uppercase letter",
  "Password must contain at least one lowercase letter",
  "Password must contain at least one number",
  "Password must contain at least one special character (e.g. @, #, $, %)",
  // Auth service
  "Email already registered",
  AUTH_REGISTER_GENERIC_MESSAGE,
  "Invalid or expired invite code",
  "Invalid email or password",
  AUTH_OAUTH_GENERIC_FAILURE_MESSAGE,
  AUTH_OAUTH_LINK_FAILED_MESSAGE,
  "This account does not have Business permissions.",
  "This account does not have Staff permissions.",
  "Current password is incorrect",
  // Business / staff
  "Business not found",
  "Profile not found",
  "Staff member not found",
  "Employee not found",
  "Goal not found",
  "Goal amount must be a non-negative number",
  "Invalid start date",
  "Only business owners can add employees",
  "Only business owners can update employees",
  "Only business owners can remove employees",
  "Failed to generate invite code.",
  "Name cannot be empty",
  "Email already in use",
  "We couldn't invite this email. If they already have a CareTip account, ask them to sign in instead.",
  "Name, email, and role are required",
  "Invalid location",
  "One or more tables are invalid",
  "Table does not belong to this business",
  "Selected tables must belong to a single location",
  "Selected tables must belong to the assigned location",
  "Not allowed",
  // Locations / tables (venue QR)
  "Location name is required",
  "Table name is required",
  "name and locationId are required",
  "name is required",
  "Location not found",
  "Table not found",
  "Stripe payment processing is not configured",
  "Invalid amount or business context",
  "Invalid tip amount",
  "Amount too small",
  "Payment provider could not start checkout",
  "This QR slug is already in use",
  "Could not generate a unique QR slug",
  "qrSlug must be 3–128 characters: letters, numbers, hyphens, underscores",
  "QR code will be available after business verification.",
  "QR code generation will be enabled after admin verification.",
  // Auth middleware (already safe)
  "Authentication required",
  "Invalid or expired token",
  "Insufficient permissions",
  "Email verification required",
  "Email is not verified.",
  "Your email is not verified. Please check your inbox and verify your account before logging in.",
  "Email is already verified.",
  "We sent a new verification link to your email.",
  "Account pending verification.",
  "This staff member is not available for tips right now.",
  "This feature is available after your venue is approved to go live.",
  "An active subscription is required to use this feature.",
  "An active subscription is required to manage locations.",
  "This feature is available on Pro.",
  "Your plan supports one location. Upgrade to Business for multi-location support.",
  "Your plan supports one table. Upgrade to Business for multiple tables.",
  "You've reached a limit on your current plan.",
]);

/** Thrown from auth login when credentials are valid but `emailVerified` is false. */
export const EMAIL_NOT_VERIFIED_CODE = "EMAIL_NOT_VERIFIED" as const;

export class EmailNotVerifiedLoginError extends Error {
  readonly code = EMAIL_NOT_VERIFIED_CODE;
  readonly canResend = true as const;
  constructor() {
    super("Your email is not verified. Please check your inbox and verify your account before logging in.");
    this.name = "EmailNotVerifiedLoginError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function logServerError(
  context: string,
  err: unknown,
  meta?: Record<string, unknown>,
): void {
  if (meta && Object.keys(meta).length > 0) {
    console.error(`[${context}]`, meta, err);
  } else {
    console.error(`[${context}]`, err);
  }
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  void import("../instrument/sentry.js").then(({ captureServerException }) => {
    captureServerException(err, { context, ...meta });
  });
}

function prismaClientMessage(err: unknown): string | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return AUTH_REGISTER_GENERIC_MESSAGE;
    }
    if (err.code === "P2025") {
      return "We couldn't find that record. It may have been removed.";
    }
    if (err.code === "P2003") {
      return "This action couldn't be completed because related data is missing.";
    }
    if (err.code === "P2014") {
      return "This action couldn't be completed due to related records.";
    }
    if (err.code === "P2022" || err.code === "P2021") {
      // Schema drift / incomplete deploy — never expose CLI or table names to guests.
      return "This feature is temporarily unavailable. Please try again in a few minutes.";
    }
    return null;
  }
  return null;
}

/** Maps known internal/service errors to calm, user-safe copy (never env names, buckets, or stack text). */
function scrubKnownInternalMessage(raw: string): string | null {
  const msg = raw.trim();
  if (!msg) return null;
  if (msg.startsWith("Photo storage is not configured on this server.")) {
    return "Photo upload isn't available on this server right now. Please try again later.";
  }
  if (msg.startsWith("Photo upload is not configured on this server.")) {
    return "File upload isn't available right now. Please try again later.";
  }
  if (msg.startsWith("Supabase Storage is not configured")) {
    return "File upload isn't available right now. Please try again later.";
  }
  if (msg.includes("Supabase storage returned no public URL")) {
    return "We couldn't save your file. Please try again.";
  }
  if (msg.startsWith("Uploaded object is missing or not readable")) {
    return "We couldn't confirm the upload. Please try again.";
  }
  if (msg.startsWith("Storage returned a URL that is not a Supabase public object URL.")) {
    return "We couldn't complete the upload. Please try again.";
  }
  if (msg.startsWith("Supabase storage upload failed") || msg.toLowerCase().includes("bucket")) {
    return "We couldn't save your file. Please try again.";
  }
  return null;
}

/**
 * Returns a message safe to send in JSON `{ message }` or a generic fallback.
 * Always call {@link logServerError} first when handling unexpected errors.
 */
export function clientSafeMessage(err: unknown, fallback: string): string {
  const prismaMsg = prismaClientMessage(err);
  if (prismaMsg) return prismaMsg;

  if (err instanceof Prisma.PrismaClientValidationError) {
    return fallback;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return fallback;
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return fallback;
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return fallback;
  }
  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return fallback;
  }

  if (err instanceof EntitlementDeniedError) {
    return err.payload.message;
  }

  const msg = err instanceof Error ? err.message : "";
  const scrubbed = scrubKnownInternalMessage(msg);
  if (scrubbed) return scrubbed;
  if (msg && ALLOWED_CLIENT_MESSAGES.has(msg)) {
    return msg;
  }
  return fallback;
}

export const CLIENT_FALLBACK = {
  /** Only when the error cannot be classified — prefer domain-specific fallbacks below. */
  generic: "Something went wrong. Please try again later.",
  register: "We couldn't create your account. Please try again.",
  loginUnexpected: "Sign-in is temporarily unavailable. Please try again in a few moments.",
  changePassword: "We couldn't update your password. Please try again.",
  business: "We couldn't save your venue or team data. Please try again.",
  businessStats: "We couldn't load dashboard stats. Please try again in a moment.",
  employee: "We couldn't update staff or your profile. Please try again.",
  staff: "We couldn't load this team member or directory. Please try again.",
  tips: "We couldn't process your tip. Please try again.",
  exportCsv: "We couldn't export your data. Please try again.",
  payment: "We couldn't start the payment. Please try again.",
  tipFeedback: "We couldn't save your feedback. Please try again.",
} as const;
