/**
 * Transactional email copy (en / de). Missing keys fall back to English at render time.
 */

import { getCareTipSupportEmail } from "../config/emailEnv.js";
import {
  formatLoginAlertDevice,
  formatLoginAlertTimestamp,
  resolveLoginAlertTimeZone,
} from "./loginAlertFormat.js";
import {
  emailBodyText,
  emailBodyTextLast,
  emailBulletList,
  emailCta,
  emailDocClose,
  emailDocOpen,
  emailFinePrint,
  emailFooterBlock,
  type EmailFooterExtras,
  emailFrameClose,
  emailFrameOpen,
  emailGreeting,
  emailHairline,
  emailHeadline,
  emailMetaBlock,
  emailPageWrap,
  emailPreheader,
  emailSectionLabel,
  emailSubheading,
  emailSupportText,
} from "./emailLayout.js";

export type EmailLocale = "en" | "de";

const SUPPORTED = new Set<EmailLocale>(["en", "de"]);

function normalizeExplicit(raw: string | null | undefined): EmailLocale | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (t.startsWith("de")) return "de";
  if (t.startsWith("en")) return "en";
  return null;
}

export function localeFromAcceptLanguage(
  header: string | null | undefined,
): EmailLocale | null {
  if (!header || typeof header !== "string") return null;
  const first = header.split(",")[0]?.trim();
  if (!first) return null;
  const tag = first.split(";")[0]?.trim().toLowerCase();
  if (!tag) return null;
  if (tag.startsWith("de")) return "de";
  if (tag.startsWith("en")) return "en";
  return null;
}

export function resolveUserPreferredLocale(
  storedLocale?: string | null,
): EmailLocale {
  const stored = normalizeExplicit(storedLocale ?? undefined);
  if (stored && SUPPORTED.has(stored)) return stored;
  return "en";
}

export function resolveEmailLocale(input: {
  explicitLocale?: string | null;
  storedLocale?: string | null;
  /** @deprecated Ignored — use User.preferredLocale / explicit CareTip UI locale only. */
  acceptLanguage?: string | null;
}): EmailLocale {
  const a = normalizeExplicit(input.explicitLocale ?? undefined);
  if (a && SUPPORTED.has(a)) return a;
  const b = normalizeExplicit(input.storedLocale ?? undefined);
  if (b && SUPPORTED.has(b)) return b;
  return "en";
}

type Bundle = {
  brand: string;
  greeting: string;
  footer: string;
  footerBrand: string;
  footerCopyright: string;
};

const common: Record<EmailLocale, Bundle> = {
  en: {
    brand: "CareTip",
    greeting: "Hello,",
    footer:
      "If you did not request this email, you can safely ignore it.",
    footerBrand: "CareTip",
    footerCopyright: `© ${new Date().getFullYear()} CareTip`,
  },
  de: {
    brand: "CareTip",
    greeting: "Hallo,",
    footer:
      "Wenn Sie diese E-Mail nicht angefordert haben, können Sie sie ignorieren.",
    footerBrand: "CareTip",
    footerCopyright: `© ${new Date().getFullYear()} CareTip`,
  },
};

function bundle(locale: EmailLocale): Bundle {
  return common[locale] ?? common.en;
}

/** Support address shown in email footers (display only). */
export { getCareTipSupportEmail } from "../config/emailEnv.js";

function footerExtras(_locale: EmailLocale): EmailFooterExtras {
  return {
    brandLine: bundle(_locale).footerBrand,
    copyrightLine: bundle(_locale).footerCopyright,
    supportEmail: getCareTipSupportEmail(),
  };
}

export function extractFirstName(fullName: string | null | undefined): string | null {
  const n = fullName?.trim();
  if (!n) return null;
  const first = n.split(/\s+/)[0]?.trim();
  return first && first.length > 0 ? first : null;
}

/** Prefer first name, then business/team name, then generic greeting. */
export function formatEmailGreeting(
  locale: EmailLocale,
  input: {
    recipientName?: string | null;
    businessName?: string | null;
  },
): string {
  const loc = locale === "de" ? "de" : "en";
  const first = extractFirstName(input.recipientName);
  if (first) {
    return loc === "de" ? `Hallo ${first},` : `Hi ${first},`;
  }
  const bn = input.businessName?.trim();
  if (bn) {
    return loc === "de" ? `Hallo ${bn},` : `Hi ${bn},`;
  }
  return bundle(loc).greeting;
}

function hoursExpiryPhrase(locale: EmailLocale, hours: number): string {
  const h = Math.max(1, Math.round(hours));
  if (locale === "de") {
    return h === 1
      ? "Dieser Link ist 1 Stunde gültig."
      : `Dieser Link ist ${h} Stunden gültig.`;
  }
  return h === 1
    ? "This link expires in 1 hour."
    : `This link expires in ${h} hours.`;
}

function renderStandardEmail(input: {
  locale: EmailLocale;
  subject: string;
  preheader: string;
  headline: string;
  greeting?: string;
  lines: string[];
  valueLine?: string;
  bulletsHeading?: string;
  bullets?: string[];
  cta?: { href: string; label: string };
  finePrint?: string[];
  helpLine?: string | null;
}): { subject: string; html: string; text: string } {
  const loc = input.locale === "de" ? "de" : "en";
  const b = bundle(loc);
  const greeting = input.greeting?.trim() || b.greeting;
  const bullets = input.bullets ?? [];
  const hasBullets = bullets.length > 0;
  const hasCta = Boolean(input.cta);
  const hasFine = (input.finePrint?.length ?? 0) > 0;

  const lineParts: string[] = [];
  for (let i = 0; i < input.lines.length; i++) {
    const isLastLine =
      i === input.lines.length - 1 && !input.valueLine && !hasBullets && !hasCta && !hasFine;
    lineParts.push(
      isLastLine ? emailBodyTextLast(input.lines[i]) : emailBodyText(input.lines[i]),
    );
  }

  const bodyParts = [
    emailHeadline(input.headline),
    emailGreeting(greeting),
    ...lineParts,
    ...(input.valueLine ? [emailBodyText(input.valueLine)] : []),
    ...(hasBullets && input.bulletsHeading
      ? [emailSectionLabel(input.bulletsHeading), emailBulletList(bullets)]
      : hasBullets
        ? [emailBulletList(bullets)]
        : []),
  ];

  const fine = (input.finePrint ?? []).map((t) => emailFinePrint(t)).join("");
  const cta = input.cta ? emailCta(input.cta.href, input.cta.label) : "";

  const inner = [
    emailFrameOpen(b.brand),
    ...bodyParts,
    fine,
    hasCta ? emailHairline() : "",
    cta,
    emailFrameClose(),
    emailFooterBlock(input.helpLine ?? null, b.footer, footerExtras(loc)),
  ].join("");

  const html = [
    emailDocOpen(loc, input.subject),
    emailPreheader(input.preheader),
    emailPageWrap(inner),
    emailDocClose(),
  ].join("");

  const textParts = [greeting, "", input.headline, "", ...input.lines];
  if (input.valueLine) textParts.push(input.valueLine);
  if (hasBullets) {
    if (input.bulletsHeading) textParts.push("", input.bulletsHeading);
    textParts.push(...bullets.map((item) => `• ${item}`));
  }
  if (input.finePrint?.length) textParts.push("", ...input.finePrint);
  if (input.cta) textParts.push("", `${input.cta.label}: ${input.cta.href}`);
  if (input.helpLine) textParts.push("", input.helpLine);
  textParts.push("", b.footerBrand, b.footerCopyright, getCareTipSupportEmail(), "", b.footer);

  return { subject: input.subject, html, text: textParts.join("\n") };
}

export function buildVerifyEmailContent(input: {
  locale: EmailLocale;
  verifyUrl: string;
  /** Optional HTTPS fallback when primary CTA is the mobile app scheme. */
  secondaryVerifyUrl?: string | null;
  expiresInHours?: number;
  recipientName?: string | null;
  businessName?: string | null;
}): { subject: string; html: string; text: string } {
  const loc = input.locale === "de" ? "de" : "en";
  const expires = hoursExpiryPhrase(loc, input.expiresInHours ?? 1);
  const greeting = formatEmailGreeting(loc, {
    recipientName: input.recipientName,
    businessName: input.businessName,
  });
  const secondary = input.secondaryVerifyUrl?.trim() || "";
  const mobileCta = Boolean(secondary);
  const copy =
    loc === "de"
      ? {
          subject: "E-Mail-Adresse bestätigen",
          preheader: "Bestätigen Sie Ihre E-Mail für CareTip.",
          headline: "E-Mail bestätigen",
          line1:
            "Bitte bestätigen Sie Ihre E-Mail-Adresse, um Ihr CareTip-Konto für digitales Trinkgeld und Team-Einblicke zu aktivieren.",
          cta: mobileCta ? "In der CareTip-App bestätigen" : "E-Mail bestätigen",
          fallback: mobileCta
            ? `Falls die App nicht öffnet, nutzen Sie diesen Link: ${secondary}`
            : "",
        }
      : {
          subject: "Verify your email",
          preheader: "Confirm your email for CareTip.",
          headline: "Verify your email",
          line1:
            "Please verify your email address to activate your CareTip account for QR tipping and team insights.",
          cta: mobileCta ? "Verify in the CareTip app" : "Verify email",
          fallback: mobileCta
            ? `If the app does not open, use this link: ${secondary}`
            : "",
        };
  const finePrint = [expires];
  if (copy.fallback) finePrint.push(copy.fallback);
  return renderStandardEmail({
    locale: loc,
    subject: copy.subject,
    preheader: copy.preheader,
    headline: copy.headline,
    greeting,
    lines: [copy.line1],
    cta: { href: input.verifyUrl, label: copy.cta },
    finePrint,
  });
}

export function buildPasswordResetContent(input: {
  locale: EmailLocale;
  resetUrl: string;
  expiresInHours?: number;
  recipientName?: string | null;
  businessName?: string | null;
}): { subject: string; html: string; text: string } {
  const loc = input.locale === "de" ? "de" : "en";
  const expires = hoursExpiryPhrase(loc, input.expiresInHours ?? 1);
  const greeting = formatEmailGreeting(loc, {
    recipientName: input.recipientName,
    businessName: input.businessName,
  });
  const copy =
    loc === "de"
      ? {
          subject: "Passwort zurücksetzen",
          preheader: "Link zum Zurücksetzen Ihres CareTip-Passworts.",
          headline: "Passwort zurücksetzen",
          line1: "Sie haben ein Zurücksetzen des Passworts für Ihr CareTip-Konto angefordert.",
          cta: "Passwort zurücksetzen",
          warn: "Wenn Sie das nicht waren, ignorieren Sie diese E-Mail.",
        }
      : {
          subject: "Reset your password",
          preheader: "Link to reset your CareTip password.",
          headline: "Reset your password",
          line1: "You requested a password reset for your CareTip account.",
          cta: "Reset password",
          warn: "If you did not request this, you can ignore this email.",
        };
  return renderStandardEmail({
    locale: loc,
    subject: copy.subject,
    preheader: copy.preheader,
    headline: copy.headline,
    greeting,
    lines: [copy.line1],
    cta: { href: input.resetUrl, label: copy.cta },
    finePrint: [expires, copy.warn],
  });
}

export type WelcomeAccountKind = "manager" | "employee" | "other";

export function buildWelcomeEmailContent(input: {
  locale: EmailLocale;
  dashboardUrl: string;
  recipientName?: string | null;
  businessName?: string | null;
  accountKind?: WelcomeAccountKind;
}): { subject: string; html: string; text: string } {
  const loc = input.locale === "de" ? "de" : "en";
  const b = bundle(loc);
  const greeting = formatEmailGreeting(loc, {
    recipientName: input.recipientName,
    businessName: input.businessName,
  });
  const kind = input.accountKind ?? "other";

  const copy =
    loc === "de"
      ? {
          subject: `Willkommen bei ${b.brand}`,
          preheader: "Ihr CareTip-Konto ist bereit. Trinkgeld per QR und Team-Einblicke.",
          headline: `Willkommen bei ${b.brand}`,
          line1: "Ihr Konto ist bereit.",
          valueLine:
            "CareTip unterstützt Ihr Hospitality-Team mit QR-Trinkgeld, fairen Auszahlungen und Einblicken in Echtzeit.",
          bulletsHeading: "Sie können jetzt:",
          managerBullets: [
            "Ihr Unternehmensprofil vervollständigen",
            "QR-Codes für Gäste erstellen",
            "Mitarbeitende einladen",
            "Trinkgelder empfangen",
          ],
          employeeBullets: [
            "Trinkgelder per QR erhalten",
            "Ihre Einnahmen im Blick behalten",
            "Mit Ihrem Team verbunden bleiben",
          ],
          defaultBullets: [
            "Trinkgeld per QR anbieten",
            "Leistung Ihres Teams verfolgen",
            "Im Dashboard starten",
          ],
          cta: "Zum Dashboard",
        }
      : {
          subject: `Welcome to ${b.brand}`,
          preheader: "Your CareTip account is ready. QR tipping and real-time team insights.",
          headline: `Welcome to ${b.brand}`,
          line1: "Your account is ready.",
          valueLine:
            "CareTip helps your hospitality team collect tips by QR, reward staff fairly, and see performance in real time.",
          bulletsHeading: "You can now:",
          managerBullets: [
            "Complete your business profile",
            "Generate QR codes for guests",
            "Invite your staff",
            "Start receiving tips",
          ],
          employeeBullets: [
            "Receive tips via QR",
            "Track your earnings",
            "Stay connected with your team",
          ],
          defaultBullets: [
            "Offer QR tipping for guests",
            "Track team performance",
            "Get started in your dashboard",
          ],
          cta: "Go to dashboard",
        };

  const bullets =
    kind === "manager"
      ? copy.managerBullets
      : kind === "employee"
        ? copy.employeeBullets
        : copy.defaultBullets;

  return renderStandardEmail({
    locale: loc,
    subject: copy.subject,
    preheader: copy.preheader,
    headline: copy.headline,
    greeting,
    lines: [copy.line1],
    valueLine: copy.valueLine,
    bulletsHeading: copy.bulletsHeading,
    bullets,
    cta: { href: input.dashboardUrl, label: copy.cta },
  });
}

function hoursExpiryPhraseDays(locale: EmailLocale, hours: number): string {
  const h = Math.max(1, Math.round(hours));
  if (h >= 24 && h % 24 === 0) {
    const d = h / 24;
    if (locale === "de") {
      return d === 1 ? "Dieser Link ist 1 Tag gültig." : `Dieser Link ist ${d} Tage gültig.`;
    }
    return d === 1 ? "This link expires in 1 day." : `This link expires in ${d} days.`;
  }
  return hoursExpiryPhrase(locale, h);
}

export function buildEmployeeActivationContent(input: {
  locale: EmailLocale;
  businessName: string;
  activationUrl: string;
  expiresInHours?: number;
  recipientName?: string | null;
}): { subject: string; html: string; text: string } {
  const loc = input.locale === "de" ? "de" : "en";
  const b = bundle(loc);
  const bn = input.businessName;
  const greeting = formatEmailGreeting(loc, {
    recipientName: input.recipientName,
    businessName: bn,
  });
  const expires = hoursExpiryPhraseDays(loc, input.expiresInHours ?? 24);
  const copy =
    loc === "de"
      ? {
          subject: `Einladung zu ${bn} auf ${b.brand}`,
          preheader: `Aktivieren Sie Ihr Team-Konto bei ${bn}.`,
          headline: "Konto aktivieren",
          line1: `Sie wurden zu ${bn} auf ${b.brand} eingeladen.`,
          line2:
            "Legen Sie Ihr Passwort fest, um Trinkgelder per QR zu erhalten und Ihre Leistung im Team sichtbar zu machen.",
          cta: "Konto aktivieren",
        }
      : {
          subject: `Invitation to ${bn} on ${b.brand}`,
          preheader: `Activate your team account at ${bn}.`,
          headline: "Activate your account",
          line1: `You've been invited to join ${bn} on ${b.brand}.`,
          line2:
            "Set your password to receive tips by QR and keep your performance visible to the team.",
          cta: "Activate account",
        };

  const locBundle = bundle(loc);
  const inner = [
    emailFrameOpen(locBundle.brand),
    emailHeadline(copy.headline),
    emailGreeting(greeting),
    emailBodyText(copy.line1),
    emailBodyTextLast(copy.line2),
    emailHairline(),
    emailCta(input.activationUrl, copy.cta),
    emailFinePrint(expires),
    emailFrameClose(),
    emailFooterBlock(null, locBundle.footer, footerExtras(loc)),
  ].join("");

  const html = [
    emailDocOpen(loc, copy.subject),
    emailPreheader(copy.preheader),
    emailPageWrap(inner),
    emailDocClose(),
  ].join("");

  const text = [
    greeting,
    "",
    copy.line1,
    copy.line2,
    "",
    `${copy.cta}: ${input.activationUrl}`,
    "",
    expires,
    "",
    locBundle.footerBrand,
    locBundle.footerCopyright,
    getCareTipSupportEmail(),
    "",
    locBundle.footer,
  ].join("\n");

  return { subject: copy.subject, html, text };
}

export type LoginAlertVariant = "normal" | "suspicious";

export function buildLoginAlertContent(input: {
  locale: EmailLocale;
  when?: Date;
  whenIso?: string;
  userAgent?: string | null;
  timeZone?: string | null;
  appBaseUrl?: string | null;
  recipientName?: string | null;
  businessName?: string | null;
  /** City/country label — never a raw IP. */
  locationLabel?: string | null;
  variant?: LoginAlertVariant;
}): { subject: string; html: string; text: string } {
  const loc = input.locale === "de" ? "de" : "en";
  const variant = input.variant ?? "normal";
  const b = bundle(loc);
  const when = input.when ?? new Date(input.whenIso ?? Date.now());
  const timeZone = resolveLoginAlertTimeZone(input.timeZone);
  const whenFormatted = formatLoginAlertTimestamp(when, loc, timeZone);
  const device = formatLoginAlertDevice(input.userAgent, loc);
  const location = input.locationLabel?.trim() || null;
  const appBase = (input.appBaseUrl?.trim() || "https://caretip.de").replace(/\/$/, "");
  const securityUrl = `${appBase}/forgot-password`;

  const copy =
    loc === "de"
      ? {
          subject:
            variant === "suspicious"
              ? "Anmeldung bei Ihrem CareTip-Konto"
              : "Neue Anmeldung bei CareTip",
          preheader:
            variant === "suspicious"
              ? "Wir haben eine Anmeldung bei Ihrem Konto festgestellt."
              : "Es gab eine neue Anmeldung bei Ihrem CareTip-Konto.",
          headline: variant === "suspicious" ? "Anmeldeaktivität" : "Neue Anmeldung",
          intro:
            variant === "suspicious"
              ? "Es gab eine Anmeldung bei Ihrem CareTip-Konto von einem neuen Gerät oder Standort. Nachfolgend finden Sie die Details:"
              : "Ihr CareTip-Konto wurde verwendet, um sich anzumelden. Nachfolgend finden Sie die Details:",
          whenLabel: "Zeit",
          deviceLabel: "Gerät",
          locationLabel: "Standort",
          okLine:
            "Wenn Sie das waren, ist keine Aktion erforderlich. Sie können diese E-Mail ignorieren.",
          warnTitle: "War das nicht Sie?",
          warnBody:
            "Zur Sicherheit empfehlen wir, Ihr Passwort zu aktualisieren und zu prüfen, ob Ihre E-Mail-Adresse noch korrekt ist.",
          cta: "Passwort aktualisieren",
          help: "Bei Fragen besuchen Sie unsere Hilfe oder wenden Sie sich an Ihren Administrator.",
        }
      : {
          subject:
            variant === "suspicious"
              ? "Sign-in to your CareTip account"
              : "New sign-in to your CareTip account",
          preheader:
            variant === "suspicious"
              ? "We noticed a sign-in to your account."
              : "Your CareTip account was used to sign in.",
          headline: variant === "suspicious" ? "Sign-in activity" : "New sign in",
          intro:
            variant === "suspicious"
              ? "Someone signed in to your CareTip account from a new device or location. Here are the details:"
              : "Your CareTip account was used to sign in. Here are the details:",
          whenLabel: "Time",
          deviceLabel: "Device",
          locationLabel: "Location",
          okLine: "If this was you, no action is needed. You can ignore this email.",
          warnTitle: "Wasn't you?",
          warnBody:
            "For your security, we recommend updating your password and confirming your email address is still correct.",
          cta: "Update password",
          help: "Questions? Visit our Help Center or contact your administrator.",
        };

  const metaRows = [
    { label: copy.whenLabel, value: whenFormatted },
    ...(device ? [{ label: copy.deviceLabel, value: device }] : []),
    ...(location ? [{ label: copy.locationLabel, value: location }] : []),
  ];

  const greeting = formatEmailGreeting(loc, {
    recipientName: input.recipientName,
    businessName: input.businessName,
  });

  const inner = [
    emailFrameOpen(b.brand),
    emailHeadline(copy.headline),
    emailGreeting(greeting),
    emailBodyText(copy.intro),
    emailMetaBlock(metaRows),
    emailSupportText(copy.okLine),
    emailSubheading(copy.warnTitle),
    emailBodyTextLast(copy.warnBody),
    emailHairline(),
    emailCta(securityUrl, copy.cta),
    emailFrameClose(),
    emailFooterBlock(copy.help, b.footer, footerExtras(loc)),
  ].join("");

  const html = [
    emailDocOpen(loc, copy.subject),
    emailPreheader(copy.preheader),
    emailPageWrap(inner),
    emailDocClose(),
  ].join("");

  const textLines = [
    greeting,
    "",
    copy.intro,
    "",
    ...metaRows.map((r) => `${r.label}: ${r.value}`),
    "",
    copy.okLine,
    "",
    `${copy.warnTitle} ${copy.warnBody}`,
    `${copy.cta}: ${securityUrl}`,
    "",
    copy.help,
    "",
    b.footerBrand,
    b.footerCopyright,
    getCareTipSupportEmail(),
    "",
    b.footer,
  ];

  return { subject: copy.subject, html, text: textLines.join("\n") };
}

export function buildGenericNotificationContent(input: {
  locale: EmailLocale;
  title: string;
  bodyText: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  recipientName?: string | null;
  businessName?: string | null;
}): { subject: string; html: string; text: string } {
  const loc = input.locale === "de" ? "de" : "en";
  const b = bundle(loc);
  const defaultAction = loc === "de" ? "In der App öffnen" : "Open in app";
  const actionLabel = input.actionLabel?.trim() || defaultAction;
  const subject = input.title.trim() || (loc === "de" ? "Benachrichtigung" : "Notification");
  const body = input.bodyText.trim() || "";
  const url = input.actionUrl?.trim();
  const preheader =
    loc === "de" ? "Neue Benachrichtigung von CareTip." : "New notification from CareTip.";

  const greeting = formatEmailGreeting(loc, {
    recipientName: input.recipientName,
    businessName: input.businessName,
  });

  const inner = [
    emailFrameOpen(b.brand),
    emailHeadline(subject),
    emailGreeting(greeting),
    emailBodyTextLast(body),
    ...(url && url.length > 0 ? [emailHairline(), emailCta(url, actionLabel)] : []),
    emailFrameClose(),
    emailFooterBlock(null, b.footer, footerExtras(loc)),
  ].join("");

  const html = [
    emailDocOpen(loc, subject),
    emailPreheader(preheader),
    emailPageWrap(inner),
    emailDocClose(),
  ].join("");

  const ctaText = url && url.length > 0 ? `\n${actionLabel}: ${url}\n` : "";
  const text = `${greeting}\n\n${subject}\n\n${body}${ctaText}\n${b.footerBrand}\n${b.footerCopyright}\n${getCareTipSupportEmail()}\n\n${b.footer}`;

  return { subject, html, text };
}
