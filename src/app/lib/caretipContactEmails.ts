/**
 * Canonical CareTip public contact inboxes (web + shared copy).
 * Demo / general inquiries → info@
 * Technical support → support@
 */
export const CARETIP_SUPPORT_EMAIL = "support@caretip.de";
export const CARETIP_INFO_EMAIL = "info@caretip.de";

export const CARETIP_SUPPORT_MAILTO = `mailto:${CARETIP_SUPPORT_EMAIL}`;
export const CARETIP_INFO_MAILTO = `mailto:${CARETIP_INFO_EMAIL}`;

export type CareTipContactMailbox = "info" | "support";

export function caretipContactEmail(mailbox: CareTipContactMailbox): string {
  return mailbox === "support" ? CARETIP_SUPPORT_EMAIL : CARETIP_INFO_EMAIL;
}

/** Build a mailto URL that opens the user's mail client to the CareTip inbox. */
export function buildCaretipMailto(options: {
  mailbox: CareTipContactMailbox;
  subject: string;
  body: string;
}): string {
  const to = caretipContactEmail(options.mailbox);
  const params = new URLSearchParams();
  params.set("subject", options.subject);
  params.set("body", options.body);
  return `mailto:${to}?${params.toString()}`;
}

export function openCaretipMailto(options: {
  mailbox: CareTipContactMailbox;
  subject: string;
  body: string;
}): void {
  window.location.href = buildCaretipMailto(options);
}
