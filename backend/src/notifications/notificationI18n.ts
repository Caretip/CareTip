import type { EmailLocale } from "../emails/i18nEmail.js";
import { resolveUserPreferredLocale } from "../emails/i18nEmail.js";
import type { SupportTicketCategory } from "@prisma/client";
import { categoryLabelLocalized } from "../services/supportTicketFormat.js";
import { resolveTipCustomerDisplayName } from "./tipCustomerName.js";

export function formatNotificationAmount(amount: number, locale: EmailLocale): string {
  return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB", {
    style: "currency",
    currency: "EUR",
  }).format(amount);
}

export function formatNotificationAmountCents(
  cents: number,
  currency: string,
  locale: EmailLocale,
): string {
  return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB", {
    style: "currency",
    currency: currency?.trim() || "EUR",
  }).format(cents / 100);
}

export function formatNotificationDateTime(iso: string, locale: EmailLocale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export type NotificationTemplate =
  | { id: "tip_received_employee"; params: { amount: number; customerName: string | null } }
  | { id: "tip_received_business"; params: { amount: number; employeeName: string } }
  | { id: "payout_completed"; params: { amount: number } }
  | { id: "login_security" }
  | { id: "employee_invited_manager"; params: { employeeName: string; businessName: string } }
  | { id: "employee_invite_redeemed_manager"; params: { employeeName: string; businessName: string; inviteCode: string } }
  | { id: "employee_activated"; params: { businessName: string } }
  | { id: "qr_scan"; params: { place: string } }
  | { id: "qr_payment_success"; params: { amount: number; employeeName: string } }
  | { id: "verification_document_uploaded"; params: { businessName: string } }
  | { id: "business_verification_approved"; params: { businessName: string } }
  | { id: "business_verification_rejected"; params: { businessName: string } }
  | { id: "support_created_admin"; params: { ticketNumber: string; businessName: string; category: SupportTicketCategory } }
  | { id: "support_created_business"; params: { ticketNumber: string; subject: string } }
  | { id: "support_reply_admin"; params: { ticketNumber: string; businessName: string; preview: string } }
  | { id: "support_reply_business"; params: { ticketNumber: string; preview: string } }
  | { id: "support_status_resolved" }
  | { id: "support_status_closed" }
  | { id: "support_status_updated"; params: { status: string } }
  | { id: "support_inbox_title"; params: { ticketNumber: string; status: string; subject: string } }
  | { id: "physical_qr_paid" }
  | {
      id: "physical_qr_paid_admin";
      params: {
        businessName: string;
        orderId: string;
        productLabel: string;
        quantity: number;
        totalAmountCents: number;
        currency: string;
        paidAtIso: string;
      };
    }
  | { id: "physical_qr_printing" }
  | { id: "physical_qr_shipped"; params: { trackingNumber: string | null } }
  | { id: "physical_qr_delivered" };

export function renderNotificationTemplate(
  locale: EmailLocale,
  template: NotificationTemplate,
): { title: string; body: string } {
  const de = locale === "de";
  switch (template.id) {
    case "tip_received_employee": {
      const amount = formatNotificationAmount(template.params.amount, locale);
      const legacyName = (template.params as { name?: string }).name;
      const tipper = resolveTipCustomerDisplayName(
        template.params.customerName ?? legacyName,
        locale,
      );
      return de
        ? {
            title: "Sie haben ein neues Trinkgeld erhalten",
            body: `${tipper} hat Ihnen ${amount} Trinkgeld gegeben`,
          }
        : { title: "You received a new tip", body: `${tipper} tipped you ${amount}` };
    }
    case "tip_received_business": {
      const amount = formatNotificationAmount(template.params.amount, locale);
      return de
        ? {
            title: "Neues Trinkgeld in Ihrem Betrieb",
            body: `${amount} für ${template.params.employeeName}`,
          }
        : {
            title: "New tip at your venue",
            body: `${amount} for ${template.params.employeeName}`,
          };
    }
    case "payout_completed": {
      const amount = formatNotificationAmount(template.params.amount, locale);
      return de
        ? {
            title: "Auszahlung abgeschlossen",
            body: `Eine Auszahlung über ${amount} wurde verarbeitet.`,
          }
        : {
            title: "Payout completed",
            body: `A payout of ${amount} was processed.`,
          };
    }
    case "login_security":
      return de
        ? {
            title: "Neue Anmeldung",
            body: "Ihr CareTip Konto wurde verwendet. Wenn Sie das nicht waren, ändern Sie Ihr Passwort.",
          }
        : {
            title: "New sign in",
            body: "Your CareTip account was used to sign in. If this wasn't you, change your password.",
          };
    case "employee_invited_manager":
      return de
        ? {
            title: "Teameinladung gesendet",
            body: `${template.params.employeeName} wurde eingeladen, ${template.params.businessName} beizutreten.`,
          }
        : {
            title: "Team invitation sent",
            body: `${template.params.employeeName} was invited to join ${template.params.businessName}.`,
          };
    case "employee_invite_redeemed_manager":
      return de
        ? {
            title: "Einladung eingelöst",
            body: `${template.params.employeeName} ist ${template.params.businessName} mit Code ${template.params.inviteCode} beigetreten.`,
          }
        : {
            title: "Invite redeemed",
            body: `${template.params.employeeName} joined ${template.params.businessName} using invite code ${template.params.inviteCode}.`,
          };
    case "employee_activated":
      return de
        ? {
            title: "Willkommen bei CareTip",
            body: `Ihr Konto für ${template.params.businessName} ist bereit. Sie können sich anmelden und Trinkgelder erhalten.`,
          }
        : {
            title: "Welcome to CareTip",
            body: `Your account for ${template.params.businessName} is ready. You can sign in and start receiving tips.`,
          };
    case "qr_scan":
      return de
        ? {
            title: "QR Code gescannt",
            body: `Ein Gast hat die Trinkgeld Seite für ${template.params.place} geöffnet.`,
          }
        : {
            title: "QR code scanned",
            body: `A guest opened the tipping page for ${template.params.place}.`,
          };
    case "qr_payment_success": {
      const amount = formatNotificationAmount(template.params.amount, locale);
      return de
        ? {
            title: "QR Zahlung erhalten",
            body: `${amount} per QR für ${template.params.employeeName}.`,
          }
        : {
            title: "QR payment received",
            body: `${amount} via QR for ${template.params.employeeName}.`,
          };
    }
    case "verification_document_uploaded":
      return de
        ? {
            title: "Verifizierungsdokument hochgeladen",
            body: `${template.params.businessName} hat Dokumente zur Prüfung eingereicht.`,
          }
        : {
            title: "Verification document uploaded",
            body: `${template.params.businessName} submitted documents for review.`,
          };
    case "business_verification_approved":
      return de
        ? {
            title: "Verifizierung freigegeben",
            body: `${template.params.businessName} ist freigeschaltet. QR-Codes und Gast-Trinkgeld können jetzt aktiviert werden.`,
          }
        : {
            title: "Venue verification approved",
            body: `${template.params.businessName} is approved. QR code generation and guest tipping are now available.`,
          };
    case "business_verification_rejected":
      return de
        ? {
            title: "Verifizierung abgelehnt",
            body: `Die Verifizierung für ${template.params.businessName} wurde nicht freigegeben. Bitte kontaktieren Sie den Support.`,
          }
        : {
            title: "Verification not approved",
            body: `Verification for ${template.params.businessName} was not approved. Please contact support.`,
          };
    case "support_created_admin": {
      const cat = categoryLabelLocalized(template.params.category, locale);
      return de
        ? {
            title: `[TICKET] ${template.params.ticketNumber}`,
            body: `${template.params.businessName}, ${cat}. Ticket öffnen, um zu antworten.`,
          }
        : {
            title: `[TICKET] ${template.params.ticketNumber}`,
            body: `${template.params.businessName}, ${cat}. Open the ticket to reply.`,
          };
    }
    case "support_created_business":
      return de
        ? {
            title: `Support Anfrage erhalten: ${template.params.ticketNumber}`,
            body: `Wir haben Ihre Nachricht zu „${template.params.subject}" erhalten. Unser Team antwortet in Kürze.`,
          }
        : {
            title: `Support request received: ${template.params.ticketNumber}`,
            body: `We received your message about "${template.params.subject}". Our team will respond shortly.`,
          };
    case "support_reply_admin":
      return de
        ? {
            title: `[TICKET] Neue Antwort: ${template.params.ticketNumber}`,
            body: `${template.params.businessName}: ${template.params.preview}`,
          }
        : {
            title: `[TICKET] New reply: ${template.params.ticketNumber}`,
            body: `${template.params.businessName}: ${template.params.preview}`,
          };
    case "support_reply_business":
      return de
        ? {
            title: `CareTip hat geantwortet: ${template.params.ticketNumber}`,
            body: template.params.preview,
          }
        : {
            title: `CareTip replied: ${template.params.ticketNumber}`,
            body: template.params.preview,
          };
    case "support_status_resolved":
      return de
        ? {
            title: "Support Anfrage erledigt",
            body: "Ihre Support Anfrage wurde als erledigt markiert.",
          }
        : {
            title: "Support request resolved",
            body: "Your support request has been marked resolved.",
          };
    case "support_status_closed":
      return de
        ? {
            title: "Support Ticket geschlossen",
            body: "Dieses Support Ticket ist jetzt geschlossen.",
          }
        : {
            title: "Support ticket closed",
            body: "This support ticket is now closed.",
          };
    case "support_status_updated":
      return de
        ? {
            title: "Ticketstatus aktualisiert",
            body: `Ticketstatus geändert auf ${template.params.status}.`,
          }
        : {
            title: "Ticket status updated",
            body: `Ticket status updated to ${template.params.status}.`,
          };
    case "support_inbox_title":
      return de
        ? {
            title: `[TICKET] [${template.params.status}] ${template.params.ticketNumber}: ${template.params.subject}`,
            body: "",
          }
        : {
            title: `[TICKET] [${template.params.status}] ${template.params.ticketNumber}: ${template.params.subject}`,
            body: "",
          };
    case "physical_qr_paid":
      return de
        ? {
            title: "Zahlung eingegangen",
            body: "Ihre physische QR-Bestellung wurde bezahlt und wird jetzt bearbeitet.",
          }
        : {
            title: "Payment received",
            body: "Your physical QR order has been paid for and is now being processed.",
          };
    case "physical_qr_paid_admin": {
      const amount = formatNotificationAmountCents(
        template.params.totalAmountCents,
        template.params.currency,
        locale,
      );
      const paidAt = formatNotificationDateTime(template.params.paidAtIso, locale);
      return de
        ? {
            title: "Physische QR-Bestellung bezahlt",
            body:
              `${template.params.businessName} hat eine physische QR-Bestellung bezahlt — bereit zur Bearbeitung. ` +
              `Bestellung: ${template.params.orderId}. Produkt: ${template.params.productLabel}. ` +
              `Menge: ${template.params.quantity}. Betrag: ${amount}. Zahlung: Bezahlt. ` +
              `Fulfillment: In Bearbeitung. Bezahlt am: ${paidAt}.`,
          }
        : {
            title: "Physical QR order paid",
            body:
              `${template.params.businessName} paid for a physical QR order — ready for processing. ` +
              `Order: ${template.params.orderId}. Product: ${template.params.productLabel}. ` +
              `Quantity: ${template.params.quantity}. Amount: ${amount}. Payment: Paid. ` +
              `Fulfillment: Processing. Paid at: ${paidAt}.`,
          };
    }
    case "physical_qr_printing":
      return de
        ? {
            title: "Druck",
            body: "Ihre physische QR-Bestellung wird jetzt gedruckt.",
          }
        : {
            title: "Printing",
            body: "Your physical QR order is now being printed.",
          };
    case "physical_qr_shipped": {
      const tracking = template.params.trackingNumber?.trim();
      return de
        ? {
            title: "Versendet",
            body: tracking
              ? `Ihre physische QR-Bestellung wurde versendet. Sendungsnummer: ${tracking}`
              : "Ihre physische QR-Bestellung wurde versendet.",
          }
        : {
            title: "Shipped",
            body: tracking
              ? `Your physical QR order has been shipped. Tracking number: ${tracking}`
              : "Your physical QR order has been shipped.",
          };
    }
    case "physical_qr_delivered":
      return de
        ? {
            title: "Zugestellt",
            body: "Ihre physische QR-Bestellung wurde zugestellt.",
          }
        : {
            title: "Delivered",
            body: "Your physical QR order has been delivered.",
          };
    default:
      return { title: "", body: "" };
  }
}

export function localizeNotificationPayload(
  preferredLocale: string | null | undefined,
  input: {
    title: string;
    body: string;
    localeTemplate?: NotificationTemplate;
  },
): { title: string; body: string } {
  if (input.localeTemplate) {
    const copy = renderNotificationTemplate(
      resolveUserPreferredLocale(preferredLocale),
      input.localeTemplate,
    );
    return {
      title: copy.title || input.title,
      body: copy.body || input.body,
    };
  }
  return { title: input.title, body: input.body };
}
