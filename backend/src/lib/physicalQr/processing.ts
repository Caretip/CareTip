import { DateTime } from "luxon";
import type { PhysicalQrProcessingClass } from "./types.js";

export const PHYSICAL_QR_PROCESSING_TIMEZONE = "Europe/Berlin";

export type PhysicalQrProcessingSnapshot = {
  timezone: typeof PHYSICAL_QR_PROCESSING_TIMEZONE;
  processingClass: PhysicalQrProcessingClass;
  processingDeadlineAt: Date;
  processingCopySnapshot: {
    en: string;
    de: string;
  };
};

const COPY = {
  SAME_DAY: {
    en: "Processed, printed and shipped the same day.",
    de: "Noch am selben Tag bearbeitet, gedruckt und versendet.",
  },
  WITHIN_24_HOURS: {
    en: "Processed, printed and shipped within 24 hours. Same-day shipment is not guaranteed.",
    de: "Bearbeitung, Druck und Versand innerhalb von 24 Stunden. Versand am selben Tag ist nicht garantiert.",
  },
} as const;

export const PHYSICAL_QR_DELIVERY_COPY = {
  en: "Estimated delivery: 24–72 hours after shipment.",
  de: "Voraussichtliche Lieferung: 24–72 Stunden nach Versand.",
} as const;

/**
 * Berlin local time: through 12:00 inclusive, including 11:30–12:00, is SAME_DAY
 * (processed, printed, shipped that operational day). 12:01+ → WITHIN_24_HOURS.
 */
export function classifyPhysicalQrProcessing(
  placedAt: Date,
  timezone: string = PHYSICAL_QR_PROCESSING_TIMEZONE,
): PhysicalQrProcessingClass {
  const local = DateTime.fromJSDate(placedAt, { zone: "utc" }).setZone(timezone);
  if (!local.isValid) {
    throw new Error("Invalid physical-order timestamp or timezone");
  }
  if (local.hour < 12 || (local.hour === 12 && local.minute === 0)) {
    return "SAME_DAY";
  }
  return "WITHIN_24_HOURS";
}

export function freezePhysicalQrProcessing(
  placedAt: Date,
  timezone: string = PHYSICAL_QR_PROCESSING_TIMEZONE,
): PhysicalQrProcessingSnapshot {
  const local = DateTime.fromJSDate(placedAt, { zone: "utc" }).setZone(timezone);
  if (!local.isValid) {
    throw new Error("Invalid physical-order timestamp or timezone");
  }
  const processingClass = classifyPhysicalQrProcessing(placedAt, timezone);
  const processingDeadlineAt =
    processingClass === "SAME_DAY"
      ? local.endOf("day").toUTC().toJSDate()
      : DateTime.fromJSDate(placedAt, { zone: "utc" }).plus({ hours: 24 }).toJSDate();
  return {
    timezone: PHYSICAL_QR_PROCESSING_TIMEZONE,
    processingClass,
    processingDeadlineAt,
    processingCopySnapshot: { ...COPY[processingClass] },
  };
}

export function deliveryWindowFromShippedAt(shippedAt: Date): { from: Date; to: Date } {
  const start = DateTime.fromJSDate(shippedAt, { zone: "utc" });
  return {
    from: start.plus({ hours: 24 }).toJSDate(),
    to: start.plus({ hours: 72 }).toJSDate(),
  };
}
