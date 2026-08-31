/**
 * Shared transactional email layout — calm, lightweight, mobile-friendly.
 */

import { CARETIP_EMAIL_LOGO_CID } from "./emailLogo.js";

export const EMAIL = {
  brandOrange: "#e9781c",
  brandOrangeHover: "#d96a14",
  text: "#111111",
  textSecondary: "#5c5c5c",
  textMuted: "#8a8a8a",
  textFooter: "#9ca3af",
  pageBg: "#faf9f6",
  cardBg: "#ffffff",
  font:
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif",
} as const;

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
<tr><td align="center" style="padding:32px 20px 40px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;width:100%;">
${inner}
</table>
</td></tr>
</table>`;
}

export function emailBrandMark(brand: string): string {
  // Inline CID — attached by sendResendEmail when HTML references this cid.
  return `<tr><td style="padding:0 0 20px;text-align:center;">
<img src="cid:${CARETIP_EMAIL_LOGO_CID}" width="160" height="50" alt="${esc(brand)}" style="display:inline-block;width:160px;max-width:48%;height:auto;border:0;outline:none;text-decoration:none;" />
</td></tr>`;
}

export function emailCardOpen(): string {
  return `<tr><td style="background:${EMAIL.cardBg};border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(17,17,17,0.05);">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">`;
}

export function emailCardClose(): string {
  return `</table>
</td></tr>`;
}

export function emailCardBody(padding = "32px 28px 28px"): string {
  return `<tr><td style="padding:${padding};">`;
}

export function emailCardBodyEnd(): string {
  return `</td></tr>`;
}

export function emailHeadline(text: string): string {
  return `<p style="margin:0 0 8px;font-size:22px;line-height:1.3;font-weight:700;color:${EMAIL.text};">${esc(text)}</p>`;
}

export function emailGreeting(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${EMAIL.textSecondary};">${esc(text)}</p>`;
}

export function emailBodyText(text: string, marginBottom = "16px"): string {
  return `<p style="margin:0 0 ${marginBottom};font-size:15px;line-height:1.6;color:${EMAIL.textSecondary};">${esc(text)}</p>`;
}

export function emailBodyTextLast(text: string): string {
  return `<p style="margin:0;font-size:15px;line-height:1.6;color:${EMAIL.textSecondary};">${esc(text)}</p>`;
}

export function emailMetaBlock(rows: { label: string; value: string }[]): string {
  if (rows.length === 0) return "";
  const items = rows
    .map(
      (r, i) =>
        `<p style="margin:0${i < rows.length - 1 ? " 0 16px" : ""};font-size:15px;line-height:1.5;color:${EMAIL.text};">
<span style="display:block;margin-bottom:4px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${EMAIL.textMuted};">${esc(r.label)}</span>
${esc(r.value)}
</p>`,
    )
    .join("");
  return `<div style="margin:24px 0 4px;padding:0;">${items}</div>`;
}

export function emailSubheading(text: string): string {
  return `<p style="margin:28px 0 8px;font-size:14px;line-height:1.45;font-weight:600;color:${EMAIL.text};">${esc(text)}</p>`;
}

export function emailSupportText(text: string): string {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:${EMAIL.textMuted};">${esc(text)}</p>`;
}

export function emailCta(href: string, label: string, centered = true): string {
  const align = centered ? "center" : "left";
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 4px;">
<tr><td align="${align}">
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
<tr><td align="center" style="border-radius:10px;background-color:${EMAIL.brandOrange};box-shadow:0 1px 6px rgba(233,120,28,0.18);">
<a href="${esc(href)}" style="display:inline-block;padding:11px 22px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;line-height:1.25;">${esc(label)}</a>
</td></tr>
</table>
</td></tr>
</table>`;
}

/** Short section label above bullet lists (e.g. “You can now:”). */
export function emailSectionLabel(text: string): string {
  return `<p style="margin:20px 0 10px;font-size:14px;line-height:1.45;font-weight:600;color:${EMAIL.text};">${esc(text)}</p>`;
}

/** Compact checkmark list for onboarding / feature highlights. */
export function emailBulletList(items: string[]): string {
  if (items.length === 0) return "";
  const rows = items
    .map(
      (item) =>
        `<tr><td valign="top" style="padding:0 0 8px;font-size:14px;line-height:1.55;color:${EMAIL.textSecondary};">
<span style="color:${EMAIL.brandOrange};font-weight:700;padding-right:8px;">&#10003;</span>${esc(item)}
</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 4px;">${rows}</table>`;
}

export function emailFinePrint(text: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${EMAIL.textMuted};">${esc(text)}</p>`;
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
    ? `<p style="margin:0 0 10px;font-size:12px;line-height:1.5;color:${EMAIL.textMuted};">${esc(helpLine)}</p>`
    : "";
  const brand = extras?.brandLine?.trim()
    ? `<p style="margin:0 0 6px;font-size:12px;font-weight:600;letter-spacing:0.02em;color:${EMAIL.textMuted};">${esc(extras.brandLine.trim())}</p>`
    : "";
  const supportEmail = extras?.supportEmail?.trim();
  const support = supportEmail
    ? `<p style="margin:0 0 8px;font-size:11px;line-height:1.5;color:${EMAIL.textFooter};"><a href="mailto:${esc(supportEmail)}" style="color:${EMAIL.brandOrange};text-decoration:none;">${esc(supportEmail)}</a></p>`
    : "";
  const copyright = extras?.copyrightLine?.trim()
    ? `<p style="margin:0 0 10px;font-size:11px;line-height:1.5;color:${EMAIL.textFooter};">${esc(extras.copyrightLine.trim())}</p>`
    : "";
  return `<tr><td style="padding:28px 8px 0;text-align:center;border-top:1px solid rgba(17,17,17,0.06);">
${help}
${brand}
${support}
${copyright}
<p style="margin:0;font-size:11px;line-height:1.55;color:${EMAIL.textFooter};">${esc(disclaimer)}</p>
</td></tr>`;
}
