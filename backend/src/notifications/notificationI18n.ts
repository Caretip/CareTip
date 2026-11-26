import type { EmailLocale } from "../emails/i18nEmail.js";
import { resolveUserPreferredLocale } from "../emails/i18nEmail.js";
import type { SupportTicketCategory } from "@prisma/client";
import { categoryLabelLocalized } from "../services/supportTicketFormat.js";
import { resolveTipCustomerDisplayName } from "./tipCustomerName.js";
import {
  scheduledPayoutIncidentCategoryLabelDe,
  scheduledPayoutIncidentCategoryLabelEn,
  scheduledPayoutIncidentNextActionDe,
  scheduledPayoutIncidentNextActionEn,
} from "../services/scheduledBankPayoutIncident.notify.js";
import type { ScheduledPayoutOpsIncidentCategory } from "@prisma/client";

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

/** Amounts in minor units with the Stripe currency; arrival date only when Stripe supplies one. */
export type PayoutTemplateParams = { amountCents: number; currency: string; arrivalDateIso?: string | null };

function formatPayoutArrival(iso: string | null | undefined, locale: EmailLocale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(d);
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
  | { id: "physical_qr_order_received" }
  | {
      id: "physical_qr_paid_admin";
      params: {
        businessName: string;
        orderId: string;
        productLabel: string;
        quantity: number;
        itemLineCount: number;
        lineItemsSummary: string;
        totalAmountCents: number;
        currency: string;
        paidAtIso: string;
      };
    }
  | {
      id: "physical_qr_order_received_admin";
      params: {
        businessName: string;
        orderId: string;
        productLabel: string;
        quantity: number;
        itemLineCount: number;
        lineItemsSummary: string;
        currency: string;
        receivedAtIso: string;
      };
    }
  | { id: "physical_qr_printing" }
  | { id: "physical_qr_shipped"; params: { trackingNumber: string | null } }
  | { id: "physical_qr_delivered" }
  | { id: "employee_inactivity_warning" }
  | { id: "employee_inactivity_admin"; params: { employeeName: string } }
  | { id: "employee_payout_started"; params: PayoutTemplateParams }
  | { id: "employee_payout_paid"; params: PayoutTemplateParams }
  | { id: "employee_payout_failed"; params: PayoutTemplateParams }
  | { id: "employee_payout_canceled"; params: PayoutTemplateParams }
  | { id: "business_payout_failed"; params: PayoutTemplateParams }
  | { id: "employee_payout_returned"; params: PayoutTemplateParams }
  | { id: "business_payout_returned"; params: PayoutTemplateParams }
  | {
      id: "scheduled_payout_ops_incident";
      params: {
        payoutType: "employee" | "business";
        category: string;
        subjectLabel: string;
        ledgerRef: string;
        detectedAtIso: string;
      };
    }
  | {
      id: "stripe_dispute_admin";
      params: { event: string; disputeRef: string; businessName: string; subjectKind: string };
    }
  | { id: "stripe_dispute_business"; params: { event: string } }
  | { id: "stripe_dispute_employee"; params: { event: string } };

const SUPPORT_STATUS_LABELS: Record<string, { en: string; de: string }> = {
  OPEN: { en: "Open", de: "Offen" },
  PENDING: { en: "Pending", de: "In Bearbeitung" },
  RESOLVED: { en: "Resolved", de: "Gelöst" },
  CLOSED: { en: "Closed", de: "Geschlossen" },
};

/** Same labels as the web inbox (support.status.*), never the raw enum. */
function supportStatusLabel(status: string, locale: EmailLocale): string {
  const entry = SUPPORT_STATUS_LABELS[String(status ?? "").trim().toUpperCase()];
  return entry ? entry[locale === "de" ? "de" : "en"] : String(status ?? "");
}

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
      // Same meaning as the web inbox copy: this records a tip transfer, not a bank payout.
      return de
        ? {
            title: "Trinkgeld erfasst",
            body: `${amount} wurde in Ihrer Trinkgeldhistorie erfasst. Das ist keine Stripe-Bankauszahlung.`,
          }
        : {
            title: "Tip recorded",
            body: `${amount} was added to your tip history. This is not a Stripe bank payout.`,
          };
    }
    case "login_security":
      return de
        ? {
            title: "Neue Anmeldung",
            body: "Ihr CareTip-Konto wurde für eine Anmeldung verwendet. Wenn Sie das nicht waren, ändern Sie Ihr Passwort.",
          }
        : {
            title: "New sign-in",
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
            title: "QR-Code gescannt",
            body: `Ein Gast hat die Trinkgeldseite für ${template.params.place} geöffnet.`,
          }
        : {
            title: "QR code scanned",
            body: `A guest opened the tipping page for ${template.params.place}.`,
          };
    case "qr_payment_success": {
      const amount = formatNotificationAmount(template.params.amount, locale);
      return de
        ? {
            title: "QR-Zahlung erhalten",
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
            title: `Support-Anfrage erhalten: ${template.params.ticketNumber}`,
            body: `Wir haben Ihre Nachricht zu „${template.params.subject}“ erhalten. Unser Team antwortet in Kürze.`,
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
            title: "Support-Anfrage erledigt",
            body: "Ihre Support-Anfrage wurde als erledigt markiert.",
          }
        : {
            title: "Support request resolved",
            body: "Your support request has been marked as resolved.",
          };
    case "support_status_closed":
      return de
        ? {
            title: "Support-Ticket geschlossen",
            body: "Dieses Support-Ticket ist jetzt geschlossen.",
          }
        : {
            title: "Support ticket closed",
            body: "This support ticket is now closed.",
          };
    case "support_status_updated": {
      const status = supportStatusLabel(template.params.status, locale);
      return de
        ? {
            title: "Ticketstatus aktualisiert",
            body: `Der Status Ihres Tickets ist jetzt: ${status}.`,
          }
        : {
            title: "Ticket status updated",
            body: `Your ticket status is now: ${status}.`,
          };
    }
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
            title: "Zahlung für Ihre QR-Bestellung eingegangen",
            body: "Ihre physische QR-Bestellung wurde bezahlt und wird jetzt bearbeitet.",
          }
        : {
            title: "Payment received for your QR order",
            body: "Your physical QR order has been paid for and is now being processed.",
          };
    case "physical_qr_order_received":
      return de
        ? {
            title: "Ihre QR-Bestellung ist eingegangen",
            body: "Ihre physische QR-Bestellung ist eingegangen und wird jetzt bearbeitet.",
          }
        : {
            title: "We received your QR order",
            body: "Your physical QR order has been received and is now being processed.",
          };
    case "physical_qr_paid_admin": {
      const params = template.params;
      if (!params || typeof params !== "object") {
        return { title: "", body: "" };
      }
      const amount = formatNotificationAmountCents(
        Number(params.totalAmountCents) || 0,
        typeof params.currency === "string" ? params.currency : "EUR",
        locale,
      );
      const paidAt = formatNotificationDateTime(
        typeof params.paidAtIso === "string" ? params.paidAtIso : "",
        locale,
      );
      const productLabel = typeof params.productLabel === "string" ? params.productLabel : "";
      const summary =
        typeof params.lineItemsSummary === "string" ? params.lineItemsSummary.trim() : "";
      const itemsLine = summary || productLabel;
      const businessName = typeof params.businessName === "string" ? params.businessName : "";
      const orderId = typeof params.orderId === "string" ? params.orderId : "";
      const itemLineCount = Number(params.itemLineCount) || 0;
      const quantity = Number(params.quantity) || 0;
      return de
        ? {
            title: "Physische QR-Bestellung bezahlt",
            body:
              `${businessName} hat eine physische QR-Bestellung bezahlt. Bereit zur Bearbeitung. ` +
              `Bestellung: ${orderId}. Positionen (${itemLineCount}): ${itemsLine}. ` +
              `Gesamtmenge: ${quantity}. Betrag: ${amount}. Zahlung: Bezahlt. ` +
              `Abwicklung: In Bearbeitung. Bezahlt am: ${paidAt}.`,
          }
        : {
            title: "Physical QR order paid",
            body:
              `${businessName} paid for a physical QR order. Ready for processing. ` +
              `Order: ${orderId}. Items (${itemLineCount}): ${itemsLine}. ` +
              `Total quantity: ${quantity}. Amount: ${amount}. Payment: Paid. ` +
              `Fulfillment: Processing. Paid at: ${paidAt}.`,
          };
    }
    case "physical_qr_order_received_admin": {
      const params = template.params;
      if (!params || typeof params !== "object") {
        return { title: "", body: "" };
      }
      const receivedAt = formatNotificationDateTime(
        typeof params.receivedAtIso === "string" ? params.receivedAtIso : "",
        locale,
      );
      const productLabel = typeof params.productLabel === "string" ? params.productLabel : "";
      const summary =
        typeof params.lineItemsSummary === "string" ? params.lineItemsSummary.trim() : "";
      const itemsLine = summary || productLabel;
      const businessName = typeof params.businessName === "string" ? params.businessName : "";
      const orderId = typeof params.orderId === "string" ? params.orderId : "";
      const itemLineCount = Number(params.itemLineCount) || 0;
      const quantity = Number(params.quantity) || 0;
      return de
        ? {
            title: "Physische QR-Bestellung eingegangen",
            body:
              `${businessName} hat eine physische QR-Bestellung aufgegeben (im Tarif enthalten). Bereit zur Bearbeitung. ` +
              `Bestellung: ${orderId}. Positionen (${itemLineCount}): ${itemsLine}. ` +
              `Gesamtmenge: ${quantity}. Zahlung: Im Tarif enthalten. ` +
              `Abwicklung: In Bearbeitung. Eingegangen am: ${receivedAt}.`,
          }
        : {
            title: "Physical QR order received",
            body:
              `${businessName} placed a physical QR order (included in plan). Ready for processing. ` +
              `Order: ${orderId}. Items (${itemLineCount}): ${itemsLine}. ` +
              `Total quantity: ${quantity}. Payment: Included in plan. ` +
              `Fulfillment: Processing. Received at: ${receivedAt}.`,
          };
    }
    case "physical_qr_printing":
      return de
        ? {
            title: "Ihre QR-Bestellung wird gedruckt",
            body: "Ihre physische QR-Bestellung wird jetzt gedruckt.",
          }
        : {
            title: "Your QR order is being printed",
            body: "Your physical QR order is now being printed.",
          };
    case "physical_qr_shipped": {
      const tracking = template.params.trackingNumber?.trim();
      return de
        ? {
            title: "Ihre QR-Bestellung wurde versendet",
            body: tracking
              ? `Ihre physische QR-Bestellung wurde versendet. Sendungsnummer: ${tracking}.`
              : "Ihre physische QR-Bestellung wurde versendet.",
          }
        : {
            title: "Your QR order has shipped",
            body: tracking
              ? `Your physical QR order has been shipped. Tracking number: ${tracking}.`
              : "Your physical QR order has been shipped.",
          };
    }
    case "physical_qr_delivered":
      return de
        ? {
            title: "Ihre QR-Bestellung wurde zugestellt",
            body: "Ihre physische QR-Bestellung wurde zugestellt.",
          }
        : {
            title: "Your QR order was delivered",
            body: "Your physical QR order has been delivered.",
          };
    case "employee_inactivity_warning":
      return de
        ? {
            title: "Ihr Profil wird in 10 Tagen inaktiv gesetzt",
            body: "Für Ihr CareTip-Profil ist seit längerer Zeit kein Trinkgeld eingegangen. Es wird daher in 10 Tagen inaktiv gesetzt.",
          }
        : {
            title: "Your profile will become inactive in 10 days",
            body: "Your CareTip profile has not received a tip for some time, so it will be set to inactive in 10 days.",
          };
    case "employee_inactivity_admin":
      return de
        ? {
            title: "Teammitglied wegen Inaktivität inaktiv gesetzt",
            body: `${template.params.employeeName} wurde in CareTip inaktiv gesetzt, weil 45 Tage lang kein anrechenbares Trinkgeld eingegangen ist. Das Stripe-Konto bleibt verbunden.`,
          }
        : {
            title: "A team member was set inactive due to inactivity",
            body: `${template.params.employeeName} was set inactive in CareTip after 45 days without an eligible tip. Their Stripe account was not disconnected.`,
          };
    case "employee_payout_started": {
      const amount = formatNotificationAmountCents(template.params.amountCents, template.params.currency, locale);
      const arrival = formatPayoutArrival(template.params.arrivalDateIso, locale);
      return de
        ? {
            title: "Auszahlung gestartet",
            body: arrival
              ? `Eine Auszahlung über ${amount} auf Ihr Bankkonto wurde gestartet. Voraussichtliche Ankunft laut Stripe: ${arrival}.`
              : `Eine Auszahlung über ${amount} auf Ihr Bankkonto wurde gestartet.`,
          }
        : {
            title: "Payout started",
            body: arrival
              ? `A payout of ${amount} to your bank account has started. Stripe expects it to arrive on ${arrival}.`
              : `A payout of ${amount} to your bank account has started.`,
          };
    }
    case "employee_payout_paid": {
      const amount = formatNotificationAmountCents(template.params.amountCents, template.params.currency, locale);
      return de
        ? {
            title: "Auszahlung an Ihre Bank gesendet",
            body: `Ihre Auszahlung über ${amount} wurde an Ihr Bankkonto gesendet. Je nach Bank kann es etwas dauern, bis der Betrag sichtbar ist.`,
          }
        : {
            title: "Payout sent to your bank",
            body: `Your payout of ${amount} has been sent to your bank account. Depending on your bank, it can take a little while to appear.`,
          };
    }
    case "employee_payout_failed": {
      const amount = formatNotificationAmountCents(template.params.amountCents, template.params.currency, locale);
      return de
        ? {
            title: "Auszahlung fehlgeschlagen",
            body: `Ihre Auszahlung über ${amount} konnte nicht abgeschlossen werden. Der Betrag geht zurück auf Ihr Stripe-Guthaben. Bitte prüfen Sie Ihre Auszahlungsdaten in CareTip.`,
          }
        : {
            title: "Payout could not be completed",
            body: `Your payout of ${amount} could not be completed. The amount returns to your Stripe balance. Please check your payout details in CareTip.`,
          };
    }
    case "employee_payout_canceled": {
      const amount = formatNotificationAmountCents(template.params.amountCents, template.params.currency, locale);
      return de
        ? {
            title: "Auszahlung storniert",
            body: `Ihre Auszahlung über ${amount} wurde storniert. Der Betrag bleibt auf Ihrem Stripe-Guthaben.`,
          }
        : {
            title: "Payout cancelled",
            body: `Your payout of ${amount} was cancelled. The amount stays in your Stripe balance.`,
          };
    }
    case "business_payout_failed": {
      const amount = formatNotificationAmountCents(template.params.amountCents, template.params.currency, locale);
      return de
        ? {
            title: "Auszahlung an Ihren Betrieb fehlgeschlagen",
            body: `Eine Auszahlung über ${amount} auf das Bankkonto Ihres Betriebs konnte nicht abgeschlossen werden. Bitte prüfen Sie Ihre Bankdaten bei Stripe.`,
          }
        : {
            title: "Business payout could not be completed",
            body: `A payout of ${amount} to your business bank account could not be completed. Please check your bank details in Stripe.`,
          };
    }
    case "employee_payout_returned": {
      const amount = formatNotificationAmountCents(template.params.amountCents, template.params.currency, locale);
      return de
        ? {
            title: "Auszahlung von Ihrer Bank zurückgebucht",
            body: `Ihre Auszahlung über ${amount} wurde von Ihrer Bank zurückgebucht. Stripe bucht den Betrag auf Ihr Stripe-Guthaben zurück. Dort wird er sichtbar, sobald die Rückbuchung abgeschlossen ist. Bitte prüfen Sie Ihre Bankdaten in CareTip.`,
          }
        : {
            title: "Payout returned by your bank",
            body: `Your payout of ${amount} was returned by your bank. Stripe is moving the amount back to your Stripe balance, where it will show once the return is complete. Please check your bank details in CareTip.`,
          };
    }
    case "business_payout_returned": {
      const amount = formatNotificationAmountCents(template.params.amountCents, template.params.currency, locale);
      return de
        ? {
            title: "Auszahlung an Ihren Betrieb zurückgebucht",
            body: `Eine Auszahlung über ${amount} auf das Bankkonto Ihres Betriebs wurde von der Bank zurückgebucht. Stripe bucht den Betrag auf das Stripe-Guthaben zurück. Bitte prüfen Sie Ihre Bankdaten bei Stripe.`,
          }
        : {
            title: "Business payout returned by the bank",
            body: `A payout of ${amount} to your business bank account was returned by the bank. Stripe is moving the amount back to the Stripe balance. Please check your bank details in Stripe.`,
          };
    }
    case "scheduled_payout_ops_incident": {
      const category = template.params.category as ScheduledPayoutOpsIncidentCategory;
      const payoutLabel = de
        ? template.params.payoutType === "employee"
          ? "Mitarbeiter"
          : "Unternehmen"
        : template.params.payoutType === "employee"
          ? "Employee"
          : "Business";
      const categoryLabel = de
        ? scheduledPayoutIncidentCategoryLabelDe(category)
        : scheduledPayoutIncidentCategoryLabelEn(category);
      const detected = formatNotificationDateTime(template.params.detectedAtIso, locale);
      const nextAction = de
        ? scheduledPayoutIncidentNextActionDe(category)
        : scheduledPayoutIncidentNextActionEn(category);
      return de
        ? {
            title: `Geplante Bankauszahlung: ${categoryLabel}`,
            body: `${payoutLabel} · ${template.params.subjectLabel} · Ledger ${template.params.ledgerRef} · erkannt ${detected}. ${nextAction}`,
          }
        : {
            title: `Scheduled bank payout: ${categoryLabel}`,
            body: `${payoutLabel} · ${template.params.subjectLabel} · ledger ${template.params.ledgerRef} · detected ${detected}. ${nextAction}`,
          };
    }
    case "stripe_dispute_admin": {
      const p = template.params;
      const where = p.businessName ? ` · ${p.businessName}` : "";
      const en: Record<string, [string, string]> = {
        opened: ["New Stripe dispute", "A payment was disputed. Review it and decide on evidence before the Stripe deadline."],
        evidence_due: ["Dispute evidence due soon", "The Stripe evidence deadline is close and no evidence has been submitted."],
        evidence_failed: ["Dispute evidence was not submitted", "Stripe did not accept the evidence. Open the dispute to see the error."],
        lost: ["Stripe dispute lost", "Stripe closed the dispute as lost. Review the financial outcome and any recovery."],
        won: ["Stripe dispute won", "Stripe closed the dispute in CareTip's favour."],
        funds_reinstated: ["Dispute funds reinstated", "Stripe returned withheld dispute funds to CareTip."],
        recovery_failed: ["Dispute recovery failed", "Stripe refused the transfer reversal for a lost dispute. Review it before retrying."],
        recovery_approved: ["Dispute recovery approved", "A recovery for a lost dispute was approved and started."],
        recovery_insufficient_funds: ["Recovery waiting for funds", "The connected account has no available funds yet. The approved recovery stays open and is retried."],
        recovery_partial: ["Dispute partly recovered", "Part of the approved amount was recovered. The rest stays open and is retried."],
        recovery_succeeded: ["Dispute recovery completed", "The approved amount was recovered from the transfer."],
        recovery_cancelled: ["Dispute recovery stopped", "The approved recovery was stopped because the dispute outcome changed or an admin cancelled it."],
        recovery_retries_exhausted: ["Recovery retries ended", "The approved recovery could not be completed after the scheduled retries. Review it."],
      };
      const deMap: Record<string, [string, string]> = {
        opened: ["Neue Stripe-Zahlungsanfechtung", "Eine Zahlung wurde angefochten. Bitte prüfen und vor der Stripe-Frist über Nachweise entscheiden."],
        evidence_due: ["Frist für Nachweise läuft bald ab", "Die Stripe-Frist für Nachweise ist bald erreicht, es wurden noch keine eingereicht."],
        evidence_failed: ["Nachweise wurden nicht eingereicht", "Stripe hat die Nachweise nicht angenommen. Den Fehler finden Sie in der Anfechtung."],
        lost: ["Stripe-Anfechtung verloren", "Stripe hat die Anfechtung als verloren abgeschlossen. Bitte Ergebnis und Rückholung prüfen."],
        won: ["Stripe-Anfechtung gewonnen", "Stripe hat die Anfechtung zugunsten von CareTip abgeschlossen."],
        funds_reinstated: ["Anfechtungsbetrag zurückgebucht", "Stripe hat einbehaltene Beträge an CareTip zurückgebucht."],
        recovery_failed: ["Rückholung fehlgeschlagen", "Stripe hat die Rückbuchung des Transfers für eine verlorene Anfechtung abgelehnt. Bitte vor einem neuen Versuch prüfen."],
        recovery_approved: ["Rückholung freigegeben", "Eine Rückholung für eine verlorene Anfechtung wurde freigegeben und gestartet."],
        recovery_insufficient_funds: ["Rückholung wartet auf Guthaben", "Das verbundene Konto hat noch kein verfügbares Guthaben. Die freigegebene Rückholung bleibt offen und wird erneut versucht."],
        recovery_partial: ["Anfechtung teilweise zurückgeholt", "Ein Teil des freigegebenen Betrags wurde zurückgeholt. Der Rest bleibt offen und wird erneut versucht."],
        recovery_succeeded: ["Rückholung abgeschlossen", "Der freigegebene Betrag wurde aus dem Transfer zurückgeholt."],
        recovery_cancelled: ["Rückholung beendet", "Die freigegebene Rückholung wurde beendet, weil sich das Ergebnis der Anfechtung geändert hat oder ein Admin sie abgebrochen hat."],
        recovery_retries_exhausted: ["Wiederholungen beendet", "Die freigegebene Rückholung konnte nach den geplanten Wiederholungen nicht abgeschlossen werden. Bitte prüfen."],
      };
      const pair = (de ? deMap : en)[p.event] ?? (de ? deMap.opened : en.opened);
      return { title: pair[0], body: `${pair[1]} ${de ? "Referenz" : "Reference"} ${p.disputeRef}${where}.` };
    }
    case "stripe_dispute_business": {
      const event = template.params.event;
      if (event === "won") {
        return de
          ? { title: "Anfechtung einer Trinkgeldzahlung abgeschlossen", body: "Die Bank hat die Anfechtung einer Trinkgeldzahlung zugunsten von CareTip entschieden." }
          : { title: "Tip payment dispute closed", body: "The bank decided the dispute on a tip payment in CareTip's favour." };
      }
      if (event === "lost") {
        return de
          ? { title: "Anfechtung einer Trinkgeldzahlung verloren", body: "Die Bank hat die Anfechtung einer Trinkgeldzahlung zugunsten des Karteninhabers entschieden. CareTip meldet sich, falls etwas zu tun ist." }
          : { title: "Tip payment dispute lost", body: "The bank decided the dispute on a tip payment in the cardholder's favour. CareTip will contact you if anything is needed." };
      }
      const recovery = disputeRecoveryCopy(event, de, "business");
      if (recovery) return recovery;
      return de
        ? { title: "Trinkgeldzahlung angefochten", body: "Ein Karteninhaber hat eine Trinkgeldzahlung bei seiner Bank angefochten. Sie müssen jetzt nichts tun; CareTip meldet sich, falls Informationen benötigt werden." }
        : { title: "Tip payment disputed", body: "A cardholder disputed a tip payment with their bank. You don't need to do anything now; CareTip will contact you if information is needed." };
    }
    case "stripe_dispute_employee": {
      const event = template.params.event;
      const recovery = disputeRecoveryCopy(event, de, "employee");
      if (recovery) return recovery;
      if (event === "won") {
        return de
          ? { title: "Anfechtung Ihres Trinkgelds abgeschlossen", body: "Die Bank hat die Anfechtung eines Trinkgelds an Sie zugunsten von CareTip entschieden. Ihr Trinkgeld ist davon nicht mehr betroffen." }
          : { title: "Dispute on your tip closed", body: "The bank decided the dispute on a tip paid to you in CareTip's favour. Your tip is no longer affected." };
      }
      if (event === "lost") {
        return de
          ? { title: "Anfechtung Ihres Trinkgelds verloren", body: "Die Bank hat die Anfechtung eines Trinkgelds an Sie zugunsten des Karteninhabers entschieden. Details sehen Sie in Ihrer Übersicht; CareTip meldet sich, bevor etwas zurückgeholt wird." }
          : { title: "Dispute on your tip lost", body: "The bank decided the dispute on a tip paid to you in the cardholder's favour. You can see the details in your dashboard; CareTip will tell you before anything is recovered." };
      }
      return de
        ? { title: "Trinkgeld angefochten", body: "Ein Karteninhaber hat ein Trinkgeld an Sie bei seiner Bank angefochten. Sie müssen jetzt nichts tun." }
        : { title: "Tip disputed", body: "A cardholder disputed a tip paid to you with their bank. You don't need to do anything now." };
    }
    default:
      return { title: "", body: "" };
  }
}

/** Recovery messages for the beneficiary (business or employee). No amounts: the dashboard shows them. */
function disputeRecoveryCopy(event: string, de: boolean, who: "business" | "employee"): { title: string; body: string } | null {
  const where = who === "employee" ? (de ? "in Ihrer Übersicht" : "in your dashboard") : de ? "in Ihrem Dashboard" : "in your dashboard";
  const map: Record<string, [string, string, string, string]> = {
    recovery_approved: [
      "Recovery for a lost dispute",
      `CareTip approved recovering the disputed tip amount from the original transfer. Details are ${where}.`,
      "Rückholung für eine verlorene Anfechtung",
      `CareTip hat die Rückholung des angefochtenen Trinkgeldbetrags aus dem ursprünglichen Transfer freigegeben. Details finden Sie ${where}.`,
    ],
    recovery_insufficient_funds: [
      "Recovery still open",
      `The recovery could not be completed yet because your Stripe account had no available funds. It stays open. Details are ${where}.`,
      "Rückholung noch offen",
      `Die Rückholung war noch nicht möglich, weil Ihr Stripe-Konto kein verfügbares Guthaben hatte. Sie bleibt offen. Details finden Sie ${where}.`,
    ],
    recovery_partial: [
      "Recovery partly completed",
      `Part of the disputed amount was recovered; the rest stays open. Details are ${where}.`,
      "Rückholung teilweise erfolgt",
      `Ein Teil des angefochtenen Betrags wurde zurückgeholt; der Rest bleibt offen. Details finden Sie ${where}.`,
    ],
    recovery_succeeded: [
      "Recovery completed",
      `The disputed amount was recovered from the original transfer. Details are ${where}.`,
      "Rückholung abgeschlossen",
      `Der angefochtene Betrag wurde aus dem ursprünglichen Transfer zurückgeholt. Details finden Sie ${where}.`,
    ],
    recovery_cancelled: [
      "Recovery stopped",
      `The recovery was stopped, for example because the dispute was decided in CareTip's favour. Details are ${where}.`,
      "Rückholung beendet",
      `Die Rückholung wurde beendet, zum Beispiel weil die Anfechtung zugunsten von CareTip entschieden wurde. Details finden Sie ${where}.`,
    ],
  };
  const m = map[event];
  if (!m) return null;
  return de ? { title: m[2], body: m[3] } : { title: m[0], body: m[1] };
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
    try {
      const copy = renderNotificationTemplate(
        resolveUserPreferredLocale(preferredLocale),
        input.localeTemplate,
      );
      return {
        title: copy.title || input.title,
        body: copy.body || input.body,
      };
    } catch {
      return { title: input.title, body: input.body };
    }
  }
  return { title: input.title, body: input.body };
}
