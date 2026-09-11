import { formatEur } from "@/utils/format";
import { uiLocaleTag } from "@/utils/labels";

export function formatMaskedLast4(last4: string | null | undefined): string | null {
  if (!last4 || !/^\d{2,4}$/.test(last4)) return null;
  return `•••• ${last4.slice(-4)}`;
}

export function formatCentsEur(cents: number | null | undefined): string {
  const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return formatEur(n / 100);
}

export function formatPayoutDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(uiLocaleTag(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatPayoutDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(uiLocaleTag(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatPayoutTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(uiLocaleTag(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}
