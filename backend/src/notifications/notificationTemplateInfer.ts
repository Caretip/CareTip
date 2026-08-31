import type { NotificationTemplate } from "./notificationI18n.js";

type InferInput = {
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  url?: string | null;
};

function parseEuroAmount(text: string): number | undefined {
  const m = text.match(/€\s*([\d.,]+)|([\d.,]+)\s*€/i);
  const raw = (m?.[1] ?? m?.[2])?.trim();
  if (!raw) return undefined;
  const normalized = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function suffixAfter(message: string, needles: string[]): string | undefined {
  for (const needle of needles) {
    const idx = message.lastIndexOf(needle);
    if (idx >= 0) {
      const rest = message.slice(idx + needle.length).trim();
      if (rest) return rest;
    }
  }
  return undefined;
}

function metaString(meta: Record<string, unknown>, key: string): string | undefined {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function metaNumber(meta: Record<string, unknown>, key: string): number | undefined {
  const v = meta[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Reconstruct locale template for legacy rows missing metadata.localeTemplate. */
export function inferNotificationTemplate(input: InferInput): NotificationTemplate | undefined {
  const meta = input.metadata;
  const templateId = metaString(meta, "templateId");
    if (templateId) {
    const params =
      meta.templateParams && typeof meta.templateParams === "object" && !Array.isArray(meta.templateParams)
        ? (meta.templateParams as Record<string, unknown>)
        : undefined;
    // Never return an id-only cast — render paths require params for most templates.
    if (params && Object.keys(params).length > 0) {
      return { id: templateId, params } as NotificationTemplate;
    }
    return undefined;
  }

  const url = input.url ?? metaString(meta, "url");
  const message = input.message.trim();
  const title = input.title.trim();
  const amount =
    metaNumber(meta, "amount") ?? parseEuroAmount(message) ?? parseEuroAmount(title);

  switch (input.type) {
    case "tip_received": {
      const employeeName = metaString(meta, "employeeName");
      const isBusiness =
        url === "/dashboard" ||
        url === "/dashboard/transactions" ||
        url === "/dashboard/tips/transactions" ||
        /venue|betrieb/i.test(title) ||
        /\bfor\b/i.test(message) ||
        /\bfür\b/i.test(message);
      if (isBusiness) {
        return {
          id: "tip_received_business",
          params: {
            amount: amount ?? 0,
            employeeName:
              employeeName ?? suffixAfter(message, [" for ", " für "]) ?? "Staff",
          },
        };
      }
      return {
        id: "tip_received_employee",
        params: {
          amount: amount ?? 0,
          customerName:
            metaString(meta, "customerName") ??
            (() => {
              const tippedYou = message.match(/^(.+?)\s+tipped you\s/i)?.[1]?.trim();
              if (tippedYou) return tippedYou.replace(/^[—–-]\s*/, "") || null;
              const hatIhnen = message.match(/^(.+?)\s+hat Ihnen\s/i)?.[1]?.trim();
              if (hatIhnen) return hatIhnen.replace(/^[—–-]\s*/, "") || null;
              const fromGuest = suffixAfter(message, [" from ", " von "]);
              return fromGuest?.replace(/^[—–-]\s*/, "") ?? null;
            })(),
        },
      };
    }
    case "payout_paid":
      return {
        id: "payout_completed",
        params: { amount: amount ?? 0 },
      };
    case "new_login":
      return { id: "login_security" };
    case "employee_invited":
      return {
        id: "employee_invited_manager",
        params: {
          employeeName: metaString(meta, "employeeName") ?? suffixAfter(message, [" invited to join ", " wurde eingeladen, "]) ?? "",
          businessName: metaString(meta, "businessName") ?? suffixAfter(message, [" join ", " beizutreten."]) ?? "",
        },
      };
    case "qr_scan":
      return {
        id: "qr_scan",
        params: { place: metaString(meta, "place") ?? suffixAfter(message, [" for ", " für "]) ?? "" },
      };
    case "qr_payment_success":
      return {
        id: "qr_payment_success",
        params: {
          amount: amount ?? 0,
          employeeName: metaString(meta, "employeeName") ?? suffixAfter(message, [" for ", " für "]) ?? "",
        },
      };
    case "support_ticket_created": {
      const ticketNumber = metaString(meta, "ticketNumber");
      if (url?.includes("/platform-admin/") || title.startsWith("[TICKET]")) {
        return {
          id: "support_created_admin",
          params: {
            ticketNumber: ticketNumber ?? "",
            businessName: metaString(meta, "businessName") ?? "",
            category: (metaString(meta, "category") ?? "general") as never,
          },
        };
      }
      return {
        id: "support_created_business",
        params: {
          ticketNumber: ticketNumber ?? "",
          subject: metaString(meta, "subject") ?? "",
        },
      };
    }
    case "support_ticket_reply": {
      const ticketNumber = metaString(meta, "ticketNumber") ?? "";
      if (url?.includes("/platform-admin/")) {
        return {
          id: "support_reply_admin",
          params: {
            ticketNumber,
            businessName: metaString(meta, "businessName") ?? "",
            preview: message,
          },
        };
      }
      return {
        id: "support_reply_business",
        params: { ticketNumber, preview: message },
      };
    }
    case "support_ticket_status": {
      const status = metaString(meta, "status")?.toUpperCase();
      if (status === "RESOLVED") return { id: "support_status_resolved" };
      if (status === "CLOSED") return { id: "support_status_closed" };
      return { id: "support_status_updated", params: { status: status ?? "" } };
    }
    default:
      return undefined;
  }
}
