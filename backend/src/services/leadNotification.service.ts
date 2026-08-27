import { getLeadFromAddress, sendResendEmail } from "./resendClient.js";

export type LeadType = "demo" | "support";

export type CrmLeadPayload = {
  source: "caretip_contact";
  type: LeadType;
  submittedAt: string;
  locale: string;
  fields: Record<string, string>;
  metadata: {
    userAgent?: string;
    referer?: string;
    ip?: string;
  };
};

/** Demo / sales / general inquiry inbox — backend env only (never from request body). */
export function getLeadsInbox(): string {
  return (
    process.env.LEADS_INBOX_EMAIL?.trim() ||
    process.env.INFO_INBOX_EMAIL?.trim() ||
    process.env.SALES_INBOX_EMAIL?.trim() ||
    "info@caretip.de"
  );
}

/** Technical support inbox — backend env only (never from request body). */
export function getSupportInbox(): string {
  return process.env.SUPPORT_INBOX_EMAIL?.trim() || "support@caretip.de";
}

export function resolveLeadDestination(type: LeadType): string {
  return type === "demo" ? getLeadsInbox() : getSupportInbox();
}

/** Customer's submitted email for Reply-To (not used as authenticated From). */
export function resolveLeadReplyTo(payload: CrmLeadPayload): string | undefined {
  const raw =
    payload.type === "demo"
      ? payload.fields.workEmail?.trim()
      : payload.fields.email?.trim();
  if (!raw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return undefined;
  return raw;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function field(fields: Record<string, string>, key: string): string {
  return String(fields[key] ?? "").trim();
}

function formatSubmittedAt(iso: string): string {
  const raw = iso.trim();
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function rowHtml(label: string, value: string): string {
  return `<tr>
  <td style="padding:6px 16px 6px 0;font-weight:600;vertical-align:top;color:#3f3f46;white-space:nowrap">${escapeHtml(label)}</td>
  <td style="padding:6px 0;vertical-align:top;color:#18181b">${escapeHtml(value).replace(/\n/g, "<br>")}</td>
</tr>`;
}

function messageBlockHtml(message: string): string {
  return `<p style="margin:0 0 6px;font-weight:600;color:#3f3f46">Message</p>
<div style="margin:0;padding:12px 14px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa;color:#18181b;white-space:pre-wrap;line-height:1.5">${escapeHtml(message)}</div>`;
}

/** Build inbox-facing HTML/text — never includes raw payload JSON or request metadata. */
export function buildLeadNotificationContent(payload: CrmLeadPayload): {
  subject: string;
  html: string;
  text: string;
} {
  const name =
    field(payload.fields, "fullName") ||
    field(payload.fields, "name") ||
    field(payload.fields, "workEmail") ||
    field(payload.fields, "email") ||
    "Unknown";
  const submitted = formatSubmittedAt(payload.submittedAt);

  if (payload.type === "demo") {
    const fullName = field(payload.fields, "fullName");
    const workEmail = field(payload.fields, "workEmail");
    const businessName = field(payload.fields, "businessName");
    const businessType = field(payload.fields, "businessType");
    const teamSize = field(payload.fields, "teamSize");
    const message = field(payload.fields, "message");

    const subject = `[CareTip] Demo request — ${name}`;
    const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#18181b;background:#ffffff">
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#18181b">Demo Request</h1>
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:560px">
    ${rowHtml("Name", fullName)}
    ${rowHtml("Work email", workEmail)}
    ${rowHtml("Business name", businessName)}
    ${rowHtml("Business type", businessType)}
    ${rowHtml("Team size", teamSize)}
  </table>
  <div style="margin:18px 0 0;max-width:560px">${messageBlockHtml(message)}</div>
  <p style="margin:18px 0 0;font-size:13px;color:#71717a">Submitted: ${escapeHtml(submitted)}</p>
</body>
</html>`;

    const text = [
      "Demo Request",
      "",
      `Name: ${fullName}`,
      `Work email: ${workEmail}`,
      `Business name: ${businessName}`,
      `Business type: ${businessType}`,
      `Team size: ${teamSize}`,
      "",
      "Message:",
      message,
      "",
      `Submitted: ${submitted}`,
    ].join("\n");

    return { subject, html, text };
  }

  const supportName = field(payload.fields, "name");
  const email = field(payload.fields, "email");
  const category = field(payload.fields, "category");
  const message = field(payload.fields, "message");

  const subject = `[CareTip] Support request — ${name}`;
  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#18181b;background:#ffffff">
  <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#18181b">Support Request</h1>
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:560px">
    ${rowHtml("Name", supportName)}
    ${rowHtml("Email", email)}
    ${rowHtml("Category", category)}
  </table>
  <div style="margin:18px 0 0;max-width:560px">${messageBlockHtml(message)}</div>
  <p style="margin:18px 0 0;font-size:13px;color:#71717a">Submitted: ${escapeHtml(submitted)}</p>
</body>
</html>`;

  const text = [
    "Support Request",
    "",
    `Name: ${supportName}`,
    `Email: ${email}`,
    `Category: ${category}`,
    "",
    "Message:",
    message,
    "",
    `Submitted: ${submitted}`,
  ].join("\n");

  return { subject, html, text };
}

function logLeadDiagnostics(payload: CrmLeadPayload): void {
  console.info("[lead-notification] submission diagnostics", {
    type: payload.type,
    locale: payload.locale,
    submittedAt: payload.submittedAt,
    ip: payload.metadata.ip,
    referer: payload.metadata.referer,
    userAgent: payload.metadata.userAgent
      ? `${payload.metadata.userAgent.slice(0, 160)}${payload.metadata.userAgent.length > 160 ? "…" : ""}`
      : undefined,
  });
}

export async function notifyLeadInbox(payload: CrmLeadPayload): Promise<boolean> {
  const to = resolveLeadDestination(payload.type);
  const replyTo = resolveLeadReplyTo(payload);
  const { subject, html, text } = buildLeadNotificationContent(payload);

  // Keep metadata for auditing — server logs only, never the inbox email body.
  logLeadDiagnostics(payload);

  // Human-facing lead From (hello@ / support@ on verified domain) — never customer, never noreply.
  // Customer email is Reply-To only (Resend `reply_to`). Transactional mail keeps RESEND_FROM (noreply).
  return sendResendEmail("lead-notification", {
    from: getLeadFromAddress(payload.type),
    to: [to],
    replyTo,
    subject,
    html,
    text,
  });
}
