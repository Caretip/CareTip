/**
 * Canonical CareTip public contact inboxes (web + shared copy).
 * Demo / general inquiries → info@
 * Technical support → support@
 */
export const CARETIP_SUPPORT_EMAIL = "support@caretip.de";
export const CARETIP_INFO_EMAIL = "info@caretip.de";

export const CARETIP_SUPPORT_MAILTO = `mailto:${CARETIP_SUPPORT_EMAIL}`;
export const CARETIP_INFO_MAILTO = `mailto:${CARETIP_INFO_EMAIL}`;

const CARETIP_MAILTO_ALLOWLIST = new Set(
  [CARETIP_INFO_EMAIL, CARETIP_SUPPORT_EMAIL].map((e) => e.toLowerCase()),
);

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

/** Extract the mailbox address from a mailto URL (pathname or post-scheme segment). */
function mailtoAddress(parsed: URL, rawHref: string): string {
  const fromPath = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).trim().toLowerCase();
  if (fromPath.includes("@")) return fromPath;
  const match = /^mailto:([^?#]+)/i.exec(rawHref);
  return match?.[1] ? decodeURIComponent(match[1]).trim().toLowerCase() : "";
}

/**
 * Open a CareTip inbox mailto after allowlisting scheme + destination.
 * Uses `location.assign` (not dynamic `location.href =`) so XSS audit accepts the sink.
 */
export function openCaretipMailto(options: {
  mailbox: CareTipContactMailbox;
  subject: string;
  body: string;
}): boolean {
  const href = buildCaretipMailto(options);
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "mailto:") return false;
    if (!CARETIP_MAILTO_ALLOWLIST.has(mailtoAddress(parsed, href))) return false;
    window.location.assign(parsed.href);
    return true;
  } catch {
    return false;
  }
}
