import {
  PHYSICAL_QR_SHIP_COUNTRY,
  type PhysicalQrContactSnapshot,
  type PhysicalQrShippingSnapshot,
} from "./types.js";

export class PhysicalQrShippingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DE_POSTAL_RE = /^\d{5}$/;

function asObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function readTrimmed(raw: unknown, max: number): string {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  return String(raw).trim().slice(0, max);
}

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

export function parsePhysicalQrShippingSnapshot(raw: unknown): PhysicalQrShippingSnapshot {
  const input = asObject(raw);
  const recipientName = readTrimmed(input.recipientName, 120);
  const streetLine = readTrimmed(input.streetLine, 200);
  const addressLine2 = readTrimmed(input.addressLine2, 120);
  const postalCode = readTrimmed(input.postalCode, 16).replace(/\s+/g, "");
  const city = readTrimmed(input.city, 100);
  const country = readTrimmed(input.country, 8).toUpperCase();

  if (!recipientName) {
    throw new PhysicalQrShippingError("RECIPIENT_REQUIRED", "Recipient name is required.");
  }
  if (!streetLine) {
    throw new PhysicalQrShippingError("STREET_REQUIRED", "Landmark is required.");
  }
  if (postalCode && (!DE_POSTAL_RE.test(postalCode) || postalCode === "00000")) {
    throw new PhysicalQrShippingError("INVALID_POSTAL_CODE", "Postal code must be a valid German 5-digit code when provided.");
  }
  if (!city) {
    throw new PhysicalQrShippingError("CITY_REQUIRED", "City is required.");
  }
  if (country !== PHYSICAL_QR_SHIP_COUNTRY) {
    throw new PhysicalQrShippingError("INVALID_COUNTRY", "Shipping is available in Germany only.");
  }

  return {
    recipientName,
    streetLine,
    ...(addressLine2 ? { addressLine2 } : {}),
    postalCode,
    city,
    country: PHYSICAL_QR_SHIP_COUNTRY,
  };
}

export function parsePhysicalQrContactSnapshot(
  raw: unknown,
  fallbacks: { name?: string | null; email?: string | null; phone?: string | null } = {},
): PhysicalQrContactSnapshot {
  const input = asObject(raw);
  const name = readTrimmed(input.name ?? fallbacks.name, 120);
  const email = readTrimmed(input.email ?? fallbacks.email, 160).toLowerCase();
  const phone = readTrimmed(input.phone ?? fallbacks.phone, 32);

  if (!name) {
    throw new PhysicalQrShippingError("CONTACT_NAME_REQUIRED", "A contact name is required.");
  }
  if (!email || !EMAIL_RE.test(email)) {
    throw new PhysicalQrShippingError("INVALID_EMAIL", "A valid contact email is required.");
  }
  if (!phone || digitCount(phone) < 8) {
    throw new PhysicalQrShippingError("PHONE_REQUIRED", "A contact phone number is required.");
  }

  return { name, email, phone, source: "order_form" };
}

export function readPhysicalQrShippingSnapshot(raw: unknown): PhysicalQrShippingSnapshot | null {
  if (!raw) return null;
  try {
    return parsePhysicalQrShippingSnapshot(raw);
  } catch {
    return null;
  }
}

export function readPhysicalQrContactSnapshot(raw: unknown): PhysicalQrContactSnapshot | null {
  if (!raw) return null;
  try {
    return parsePhysicalQrContactSnapshot(raw);
  } catch {
    return null;
  }
}

export function formatPhysicalQrShippingLine(snapshot: PhysicalQrShippingSnapshot): string {
  const line2 = snapshot.addressLine2 ? `, ${snapshot.addressLine2}` : "";
  const postalPart = snapshot.postalCode ? `, ${snapshot.postalCode}` : "";
  return `${snapshot.recipientName}, ${snapshot.streetLine}${line2}${postalPart} ${snapshot.city}, ${snapshot.country}`;
}
