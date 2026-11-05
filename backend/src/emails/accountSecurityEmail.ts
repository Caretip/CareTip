import {
  emailBodyText,
  emailCta,
  emailDocClose,
  emailDocOpen,
  emailFrameClose,
  emailFrameOpen,
  emailHeadline,
  emailHairline,
  emailPageWrap,
  emailPreheader,
} from "./emailLayout.js";
import type { EmailLocale } from "./i18nEmail.js";

export type AccountSecurityEmailKind =
  | "email_change_approve"
  | "email_change_confirm"
  | "email_change_requested"
  | "email_changed"
  | "mfa_changed"
  | "mfa_reset_by_admin"
  | "registration_attempt"
  | "account_recovery_confirm"
  | "account_recovery_warning";

type Copy = { subject: string; lines: string[]; cta?: string; warn?: string };

const COPY: Record<EmailLocale, Record<AccountSecurityEmailKind, Copy>> = {
  en: {
    email_change_approve: {
      subject: "Approve your CareTip email change",
      lines: ["A change to the login email of your CareTip account was requested. Nothing changes unless you approve it."],
      cta: "Review request",
      warn: "If you did not expect this, do nothing and your email stays the same. The link expires in 24 hours.",
    },
    email_change_confirm: {
      subject: "Confirm your new CareTip email",
      lines: ["Confirm this address to make it the login email of your CareTip account."],
      cta: "Confirm email",
      warn: "The link expires in 1 hour. If you did not expect this, ignore this email.",
    },
    email_change_requested: {
      subject: "A change to your CareTip login email was requested",
      lines: ["A change to your login email has been started. You will get another message if it completes."],
      warn: "If this was not you, change your password now.",
    },
    email_changed: {
      subject: "Your CareTip login email was changed",
      lines: ["The login email of your CareTip account was changed, and you were signed out on all devices."],
      warn: "If this was not you, contact support straight away.",
    },
    mfa_changed: {
      subject: "Your CareTip authenticator was changed",
      lines: ["The authenticator for your CareTip account was replaced, and your other sessions were signed out."],
      warn: "If this was not you, contact support straight away.",
    },
    mfa_reset_by_admin: {
      subject: "Your CareTip two-factor authentication was reset",
      lines: ["A platform administrator reset two-factor authentication on your account, and you were signed out on all devices."],
      warn: "If you did not ask for this, contact support straight away.",
    },
    account_recovery_confirm: {
      subject: "Confirm your CareTip recovery request",
      lines: ["Confirm this address to continue recovering your CareTip account. Support will then review your request."],
      cta: "Confirm address",
      warn: "The link expires in 1 hour. If you did not expect this, ignore this email.",
    },
    account_recovery_warning: {
      subject: "Someone asked to recover your CareTip account",
      lines: ["A request was made to move your CareTip login to a new email address. Support will check identity before anything changes."],
      cta: "Cancel this request",
      warn: "If this was not you, cancel it now and change your password.",
    },
    registration_attempt: {
      subject: "Someone tried to register with your email",
      lines: ["Someone tried to create a CareTip account with this email, but you already have one. No new account was created."],
      warn: "If this was you, sign in or reset your password. Otherwise you can ignore this email.",
    },
  },
  de: {
    email_change_approve: {
      subject: "Änderung Ihrer CareTip-E-Mail bestätigen",
      lines: ["Für Ihr CareTip-Konto wurde eine Änderung der Anmelde-E-Mail angefordert. Ohne Ihre Zustimmung ändert sich nichts."],
      cta: "Anfrage prüfen",
      warn: "Wenn Sie das nicht erwartet haben, tun Sie nichts. Ihre E-Mail bleibt dann unverändert. Der Link ist 24 Stunden gültig.",
    },
    email_change_confirm: {
      subject: "Neue CareTip-E-Mail bestätigen",
      lines: ["Bestätigen Sie diese Adresse, um sie als Anmelde-E-Mail Ihres CareTip-Kontos zu verwenden."],
      cta: "E-Mail bestätigen",
      warn: "Der Link ist 1 Stunde gültig. Wenn Sie das nicht erwartet haben, ignorieren Sie diese E-Mail.",
    },
    email_change_requested: {
      subject: "Änderung Ihrer CareTip-Anmelde-E-Mail angefordert",
      lines: ["Eine Änderung Ihrer Anmelde-E-Mail wurde gestartet. Sie erhalten eine weitere Nachricht, wenn sie abgeschlossen ist."],
      warn: "Wenn Sie das nicht waren, ändern Sie jetzt Ihr Passwort.",
    },
    email_changed: {
      subject: "Ihre CareTip-Anmelde-E-Mail wurde geändert",
      lines: ["Die Anmelde-E-Mail Ihres CareTip-Kontos wurde geändert, und Sie wurden auf allen Geräten abgemeldet."],
      warn: "Wenn Sie das nicht waren, wenden Sie sich sofort an den Support.",
    },
    mfa_changed: {
      subject: "Ihr CareTip-Authenticator wurde geändert",
      lines: ["Der Authenticator Ihres CareTip-Kontos wurde ersetzt, und Ihre anderen Sitzungen wurden abgemeldet."],
      warn: "Wenn Sie das nicht waren, wenden Sie sich sofort an den Support.",
    },
    mfa_reset_by_admin: {
      subject: "Ihre CareTip-Zwei-Faktor-Authentifizierung wurde zurückgesetzt",
      lines: ["Ein Plattform-Administrator hat die Zwei-Faktor-Authentifizierung Ihres Kontos zurückgesetzt, und Sie wurden auf allen Geräten abgemeldet."],
      warn: "Wenn Sie das nicht angefordert haben, wenden Sie sich sofort an den Support.",
    },
    account_recovery_confirm: {
      subject: "Ihre CareTip-Wiederherstellung bestätigen",
      lines: ["Bestätigen Sie diese Adresse, um die Wiederherstellung Ihres CareTip-Kontos fortzusetzen. Der Support prüft Ihre Anfrage anschließend."],
      cta: "Adresse bestätigen",
      warn: "Der Link ist 1 Stunde gültig. Wenn Sie das nicht erwartet haben, ignorieren Sie diese E-Mail.",
    },
    account_recovery_warning: {
      subject: "Jemand möchte Ihr CareTip-Konto wiederherstellen",
      lines: ["Es wurde beantragt, Ihre CareTip-Anmeldung auf eine neue E-Mail-Adresse zu übertragen. Der Support prüft die Identität, bevor sich etwas ändert."],
      cta: "Anfrage abbrechen",
      warn: "Wenn Sie das nicht waren, brechen Sie jetzt ab und ändern Sie Ihr Passwort.",
    },
    registration_attempt: {
      subject: "Registrierungsversuch mit Ihrer E-Mail",
      lines: ["Jemand hat versucht, mit dieser E-Mail ein CareTip-Konto zu erstellen, aber Sie haben bereits eines. Es wurde kein neues Konto erstellt."],
      warn: "Wenn Sie das waren, melden Sie sich an oder setzen Sie Ihr Passwort zurück. Andernfalls können Sie diese E-Mail ignorieren.",
    },
  },
};

export function buildAccountSecurityEmail(input: {
  kind: AccountSecurityEmailKind;
  locale: EmailLocale;
  ctaUrl?: string;
}): { subject: string; html: string; text: string } {
  const locale: EmailLocale = input.locale === "de" ? "de" : "en";
  const copy = COPY[locale][input.kind];
  const cta = copy.cta && input.ctaUrl ? { label: copy.cta, href: input.ctaUrl } : null;
  const inner = [
    emailFrameOpen("CareTip"),
    emailHeadline(copy.subject),
    ...copy.lines.map((line) => emailBodyText(line)),
    copy.warn ? emailBodyText(copy.warn) : "",
    cta ? emailHairline() : "",
    cta ? emailCta(cta.href, cta.label) : "",
    emailFrameClose(),
  ].join("");
  const html = [emailDocOpen(locale, copy.subject), emailPreheader(copy.lines[0]), emailPageWrap(inner), emailDocClose()].join("");
  const text = [copy.subject, "", ...copy.lines, ...(copy.warn ? ["", copy.warn] : []), ...(cta ? ["", `${cta.label}: ${cta.href}`] : [])].join("\n");
  return { subject: copy.subject, html, text };
}
