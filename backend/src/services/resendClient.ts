/**
 * Shared Resend HTTP client (same pattern as password reset — forgot-password flow is the reference).
 *
 * Resend requires `from` to be `email@example.com` or `Display Name <email@example.com>` — a bare domain
 * (e.g. `caretip.de`) returns 422 validation_error.
 */

import {
  getLeadFromOverrideRaw,
  getResendFromRaw,
  getResendSendingDomain,
  getCareTipSupportEmail,
  isValidResendFromFormat,
} from "../config/emailEnv.js";
import {
  CARETIP_EMAIL_LOGO_CID,
  getCareTipEmailLogoAttachment,
} from "../emails/emailLogo.js";

const DEFAULT_RESEND_FROM = "CareTip <no-reply@mail.caretip.com>";
/** Fallback when transactional From domain cannot be parsed (same verified CareTip mail domain). */
const DEFAULT_LEAD_SENDING_DOMAIN = "mail.caretip.de";

let warnedInvalidResendFrom = false;

function wrapCareTipFrom(emailOrNamed: string): string {
  const raw = emailOrNamed.trim();
  return raw.includes("<") ? raw : `CareTip <${raw}>`;
}

function getResendFromAddress(): string {
  const raw = getResendFromRaw();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_FROM is not configured");
    }
    return DEFAULT_RESEND_FROM;
  }
  if (isValidResendFromFormat(raw)) {
    return wrapCareTipFrom(raw);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`RESEND_FROM is invalid: ${JSON.stringify(raw)}`);
  }
  if (!warnedInvalidResendFrom) {
    warnedInvalidResendFrom = true;
    console.warn(
      `[resend] RESEND_FROM must be a full address (e.g. "noreply@yourdomain.com" or "CareTip <noreply@yourdomain.com>"). ` +
        `Got ${JSON.stringify(raw)} — using default ${DEFAULT_RESEND_FROM}. Set RESEND_FROM_EMAIL/RESEND_FROM to a verified sender in Resend.`
    );
  }
  return DEFAULT_RESEND_FROM;
}

/**
 * Human-facing lead From on the verified sending domain (never noreply, never customer).
 * Demo → hello@…  Support → support@…
 * Optional overrides: RESEND_FROM_LEADS / RESEND_FROM_SUPPORT.
 */
function getLeadFromAddress(type: "demo" | "support"): string {
  const override = getLeadFromOverrideRaw(type);
  if (override) {
    if (isValidResendFromFormat(override)) {
      return wrapCareTipFrom(override);
    }
    console.warn(
      `[resend] Invalid ${type === "demo" ? "RESEND_FROM_LEADS" : "RESEND_FROM_SUPPORT"}=${JSON.stringify(override)}; using domain default.`,
    );
  }

  const domain = getResendSendingDomain() ?? DEFAULT_LEAD_SENDING_DOMAIN;
  const local = type === "demo" ? "hello" : "support";
  return `CareTip <${local}@${domain}>`;
}

function getResendApiKey(): string | undefined {
  return process.env.RESEND_API_KEY?.trim() || undefined;
}

export { getResendFromAddress, getLeadFromAddress };

export type ResendMailAttachment = {
  filename: string;
  content_id?: string;
  content?: string;
  path?: string;
  content_type?: string;
};

export type ResendMailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  /** Resend accepts optional plain-text part (improves deliverability). */
  text?: string;
  /**
   * Customer reply address only — never used as `from`.
   * Sent to Resend as `reply_to` so staff can reply without spoofing the authenticated sender.
   */
  replyTo?: string | string[];
  /** Optional attachments (inline CID logos, etc.). */
  attachments?: ResendMailAttachment[];
};

/** Normalize to a non-empty list of emails; drops blanks. Never returns []. */
function normalizeReplyToAddresses(replyTo: string | string[] | undefined): string[] | undefined {
  if (replyTo == null) return undefined;
  const list = (Array.isArray(replyTo) ? replyTo : [replyTo])
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 0 && v.includes("@"));
  return list.length > 0 ? list : undefined;
}

/**
 * Sends one message via Resend. Does not throw on failure — logs and returns success flag.
 * Callers keep token logic separate; this only posts to Resend.
 */
export async function sendResendEmail(logTag: string, payload: ResendMailPayload): Promise<boolean> {
  const resendKey = getResendApiKey();
  const from = payload.from || getResendFromAddress();

  if (!resendKey) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[resend][${logTag}] RESEND_API_KEY not set; skipping send (dev).`);
    } else {
      console.warn(`[resend][${logTag}] RESEND_API_KEY not set; email was not sent.`);
    }
    return false;
  }

  const replyToAddresses = normalizeReplyToAddresses(
    payload.replyTo ?? getCareTipSupportEmail(),
  );

  const attachments = [...(payload.attachments ?? [])];
  const needsLogo =
    payload.html.includes(`cid:${CARETIP_EMAIL_LOGO_CID}`) &&
    !attachments.some((a) => a.content_id === CARETIP_EMAIL_LOGO_CID);
  if (needsLogo) {
    const logo = getCareTipEmailLogoAttachment();
    if (logo) attachments.push(logo);
    else if (process.env.NODE_ENV !== "production") {
      console.warn(`[resend][${logTag}] CareTip logo CID referenced but logo asset unavailable`);
    }
  }

  const body: Record<string, unknown> = {
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  };
  if (payload.text) {
    body.text = payload.text;
  }
  if (attachments.length > 0) {
    body.attachments = attachments;
  }
  // Resend accepts string | string[]. Prefer a single string when one address
  // so the dashboard/request log never shows an empty replyTo array.
  if (replyToAddresses) {
    body.reply_to = replyToAddresses.length === 1 ? replyToAddresses[0] : replyToAddresses;
  }

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error("[resend] Email sending failed:", { tag: logTag, status: r.status, body: t.slice(0, 800) });
      return false;
    }
    console.info(`[resend][${logTag}] Email sent`, {
      to: payload.to[0],
      hasReplyTo: Boolean(replyToAddresses),
    });
    return true;
  } catch (error) {
    console.error("[resend] Email sending failed:", { tag: logTag, error });
    return false;
  }
}
