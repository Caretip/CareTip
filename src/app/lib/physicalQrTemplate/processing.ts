/** Client-side processing estimate — server `placedAt` remains authoritative. */

export const PHYSICAL_QR_PROCESSING_TIMEZONE = "Europe/Berlin";

export type PhysicalQrProcessingClass = "SAME_DAY" | "WITHIN_24_HOURS";

function berlinParts(placedAt: Date): { hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: PHYSICAL_QR_PROCESSING_TIMEZONE,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(placedAt);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return { hour, minute };
  } catch {
    return null;
  }
}

/** Inclusive through 12:00 Berlin, including 11:30–12:00; 12:01+ is within 24 hours. */
export function classifyPhysicalQrProcessingClient(
  placedAt: Date,
): PhysicalQrProcessingClass {
  const parts = berlinParts(placedAt);
  if (!parts) return "WITHIN_24_HOURS";
  if (parts.hour < 12 || (parts.hour === 12 && parts.minute === 0)) return "SAME_DAY";
  return "WITHIN_24_HOURS";
}
