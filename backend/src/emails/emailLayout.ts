/**
 * Shared CareTip transactional email layout — table-based, email-client safe.
 * One light surface, 1px hairline frame, centered type — no nested cards.
 */

import { resolveCareTipEmailLogoRemoteUrl } from "./emailLogo.js";

export const EMAIL = {
  brandOrange: "#e9781c",
  brandOrangeHover: "#d96a14",
  text: "#111111",
  textSecondary: "#52525b",
  textMuted: "#71717a",
  textFooter: "#a1a1aa",
  pageBg: "#f7f7f8",
  cardBg: "#f7f7f8",
  headerBg: "#111111",
  headerText: "#ffffff",
  border: "#e4e4e7",
  hairline: "#d4d4d8",
  font:
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
} as const;

const WRAP = "word-break:break-word;overflow-wrap:anywhere;";
const CENTER = `text-align:center;${WRAP}`;

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function emailPreheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(text)}</div>`;
}

export function emailDocOpen(locale: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<!--[if mso]><style type="text/css">body,table,td{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${EMAIL.pageBg};-webkit-text-size-adjust:100%;font-family:${EMAIL.font};">`;
}

export function emailDocClose(): string {
  return `</body></html>`;
}

export function emailPageWrap(inner: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${EMAIL.pageBg};">
<tr><td align="center" style="padding:24px 16px 40px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;">
${inner}
</table>
</td></tr>
</table>`;
}

function brandIconSrc(): string {
  return resolveCareTipEmailLogoRemoteUrl();
}

/**
 * Dark CareTip brand header. Public HTTPS PNG + independent HTML wordmark
 * (white, inline color) so the name remains if the image fails to load.
 */
export function emailBrandMark(brand: string): string {
  const src = brandIconSrc();
  return `<tr><td align="center" bgcolor="${EMAIL.headerBg}" style="background-color:${EMAIL.headerBg};padding:18px 24px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
<tr>
<td valign="middle" style="padding:0;line-height:0;">
<img src="${esc(src)}" width="32" height="32" alt="CareTip" style="display:block;width:32px;height:32px;border:0;outline:none;text-decoration:none;" />
</td>
<td valign="middle" style="padding:0 0 0 10px;font-size:17px;line-height:1.2;font-weight:600;letter-spacing:-0.02em;color:${EMAIL.headerText};">${esc(brand)}</td>
</tr>
</table>
</td></tr>`;
}

/** Single 1px frame — same fill as the page, no nested white card. */
export function emailCardOpen(): string {
  return `<tr><td style="background:${EMAIL.cardBg};border:1px solid ${EMAIL.border};border-radius:8px;padding:0;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">`;
}

export function emailCardClose(): string {
  return `</table>
</td></tr>`;
}

export function emailCardBody(padding = "32px 40px 40px"): string {
  return `<tr><td align="center" style="padding:${padding};${CENTER}">`;
}

export function emailCardBodyEnd(): string {
  return `</td></tr>`;
}

/** Dark brand header as the first row of the framed message, then body. */
export function emailFrameOpen(brand: string): string {
  return `${emailCardOpen()}${emailBrandMark(brand)}${emailCardBody()}`;
}

export function emailFrameClose(): string {
  return `${emailCardBodyEnd()}${emailCardClose()}`;
}

export function emailHeadline(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;font-weight:700;letter-spacing:-0.03em;color:${EMAIL.text};${CENTER}">${esc(text)}</h1>`;
}

export function emailGreeting(text: string): string {
  return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${EMAIL.textSecondary};${CENTER}">${esc(text)}</p>`;
}

export function emailBodyText(text: string, marginBottom = "16px"): string {
  return `<p style="margin:0 0 ${marginBottom};font-size:16px;line-height:1.65;color:${EMAIL.textSecondary};${CENTER}">${esc(text)}</p>`;
}

export function emailBodyTextLast(text: string): string {
  return `<p style="margin:0;font-size:16px;line-height:1.65;color:${EMAIL.textSecondary};${CENTER}">${esc(text)}</p>`;
}

export function emailMetaBlock(rows: { label: string; value: string }[]): string {
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (r, i) =>
        `<p style="margin:0${i < rows.length - 1 ? " 0 14px" : ""};font-size:16px;line-height:1.5;color:${EMAIL.text};${CENTER}">
<span style="display:block;margin-bottom:4px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${EMAIL.textMuted};">${esc(r.label)}</span>
${esc(r.value)}
</p>`,
    )
    .join("");
  return `<div style="margin:24px 0 8px;padding:0;">${items}</div>`;
}

export function emailSubheading(text: string): string {
  return `<p style="margin:28px 0 10px;font-size:15px;line-height:1.45;font-weight:600;color:${EMAIL.text};${CENTER}">${esc(text)}</p>`;
}

export function emailSupportText(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:${EMAIL.textMuted};${CENTER}">${esc(text)}</p>`;
}

export function emailHairline(): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:28px auto 8px;">
<tr><td style="width:40px;height:1px;background-color:${EMAIL.hairline};font-size:1px;line-height:1px;">&nbsp;</td></tr>
</table>`;
}

export function emailCta(href: string, label: string, centered = true): string {
  const align = centered ? "center" : "left";
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="${align}" style="margin:28px auto 0;">
<tr><td align="center" style="border-radius:8px;background-color:${EMAIL.brandOrange};">
<a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;line-height:1.25;text-align:center;">${esc(label)}</a>
</td></tr>
</table>`;
}

/** Short section label above bullet lists (e.g. “You can now:”). */
export function emailSectionLabel(text: string): string {
  return `<p style="margin:28px 0 12px;font-size:16px;line-height:1.45;font-weight:600;color:${EMAIL.text};${CENTER}">${esc(text)}</p>`;
}

/** Compact checkmark list — shrink-wrapped so it stays centered, not a full-width card. */
export function emailBulletList(items: string[]): string {
  if (items.length === 0) return "";
  const rows = items
    .map(
      (item) =>
        `<tr><td valign="top" align="left" width="22" style="padding:0 8px 10px 0;font-size:16px;line-height:1.55;color:${EMAIL.brandOrange};font-weight:700;">&#10003;</td>
<td valign="top" align="left" style="padding:0 0 10px;font-size:16px;line-height:1.55;color:${EMAIL.textSecondary};text-align:left;${WRAP}">${esc(item)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 4px;">${rows}</table>`;
}

export function emailFinePrint(text: string): string {
  return `<p style="margin:20px 0 0;font-size:13px;line-height:1.55;color:${EMAIL.textMuted};${CENTER}">${esc(text)}</p>`;
}

export type EmailFooterExtras = {
  brandLine?: string | null;
  copyrightLine?: string | null;
  supportEmail?: string | null;
};

export function emailFooterBlock(
  helpLine: string | null,
  disclaimer: string,
  extras?: EmailFooterExtras,
): string {
  const help = helpLine
    ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:${EMAIL.textMuted};${CENTER}">${esc(helpLine)}</p>`
    : "";
  const brand = extras?.brandLine?.trim()
    ? `<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:${EMAIL.textMuted};">${esc(extras.brandLine.trim())}</p>`
    : "";
  const supportEmail = extras?.supportEmail?.trim();
  const support = supportEmail
    ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${EMAIL.textFooter};"><a href="mailto:${esc(supportEmail)}" style="color:${EMAIL.textMuted};text-decoration:underline;">${esc(supportEmail)}</a></p>`
    : "";
  const copyright = extras?.copyrightLine?.trim()
    ? `<p style="margin:0 0 12px;font-size:12px;line-height:1.5;color:${EMAIL.textFooter};">${esc(extras.copyrightLine.trim())}</p>`
    : "";
  return `<tr><td style="padding:28px 8px 0;text-align:center;">
${help}
${brand}
${support}
${copyright}
<p style="margin:0;font-size:12px;line-height:1.55;color:${EMAIL.textFooter};${CENTER}">${esc(disclaimer)}</p>
</td></tr>`;
}
