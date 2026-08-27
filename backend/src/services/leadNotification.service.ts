import { getResendFromAddress, sendResendEmail } from "./resendClient.js";

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

function getLeadsInbox(): string {
  return (
    process.env.LEADS_INBOX_EMAIL?.trim() ||
    process.env.INFO_INBOX_EMAIL?.trim() ||
    process.env.SALES_INBOX_EMAIL?.trim() ||
    "info@caretip.de"
  );
}

function getSupportInbox(): string {
  return process.env.SUPPORT_INBOX_EMAIL?.trim() || "support@caretip.de";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatFieldsHtml(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;font-weight:600;vertical-align:top">${escapeHtml(key)}</td><td style="padding:4px 0">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`,
    )
    .join("");
}

function formatFieldsText(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

export async function notifyLeadInbox(payload: CrmLeadPayload): Promise<boolean> {
  const to =
    payload.type === "demo" ? getLeadsInbox() : getSupportInbox();
  const subjectPrefix = payload.type === "demo" ? "Demo request" : "Support message";
  const name =
    payload.fields.fullName ||
    payload.fields.name ||
    payload.fields.workEmail ||
    payload.fields.email ||
    "Unknown";

  const subject = `[CareTip] ${subjectPrefix} — ${name}`;
  const jsonBlock = JSON.stringify(payload, null, 2);

  const html = `
    <h2>${escapeHtml(subjectPrefix)}</h2>
    <table>${formatFieldsHtml(payload.fields)}</table>
    <hr>
    <p><strong>Locale:</strong> ${escapeHtml(payload.locale)}</p>
    <p><strong>Submitted:</strong> ${escapeHtml(payload.submittedAt)}</p>
    <pre style="background:#f4f4f5;padding:12px;border-radius:8px;font-size:12px;overflow:auto">${escapeHtml(jsonBlock)}</pre>
  `;

  const text = `${subjectPrefix}\n\n${formatFieldsText(payload.fields)}\n\n---\n${jsonBlock}`;

  return sendResendEmail("lead-notification", {
    from: getResendFromAddress(),
    to: [to],
    subject,
    html,
    text,
  });
}
