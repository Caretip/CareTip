import type Stripe from "stripe";
import { prisma } from "../prisma.js";
import {
  buildTipGuestConfirmationContent,
  parseTipGuestPresentationLocale,
  resolveEmailLocale,
  type EmailLocale,
} from "../emails/i18nEmail.js";
import { getResendFromAddress, sendResendEmail } from "./resendClient.js";
import { logServerError } from "../utils/httpErrors.js";

export function normalizeGuestEmail(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

export function resolveGuestEmailFromCheckoutSession(
  session: Stripe.Checkout.Session,
  paymentIntent?: Stripe.PaymentIntent | null,
): string | null {
  return normalizeGuestEmail(
    session.customer_details?.email ??
      session.customer_email ??
      paymentIntent?.receipt_email ??
      null,
  );
}

export function resolveEmailLocaleFromCheckoutSession(
  session: Stripe.Checkout.Session,
): EmailLocale {
  const fromMeta = parseTipGuestPresentationLocale(session.metadata?.locale ?? null);
  if (fromMeta) return fromMeta;
  const fromStripeCheckout = parseTipGuestPresentationLocale(session.locale ?? null);
  if (fromStripeCheckout) return fromStripeCheckout;
  return resolveEmailLocale({});
}

async function loadTipConfirmationContext(transactionId: string) {
  return prisma.transaction.findUnique({
    where: { id: transactionId },
    select: {
      id: true,
      status: true,
      amount: true,
      receiptNumber: true,
      guestConfirmationEmailSentAt: true,
      employee: { select: { name: true } },
      business: { select: { name: true } },
    },
  });
}

async function claimGuestConfirmationSend(transactionId: string): Promise<boolean> {
  const claimed = await prisma.transaction.updateMany({
    where: {
      id: transactionId,
      status: "success",
      guestConfirmationEmailSentAt: null,
    },
    data: { guestConfirmationEmailSentAt: new Date() },
  });
  return claimed.count === 1;
}

async function releaseGuestConfirmationClaim(transactionId: string): Promise<void> {
  await prisma.transaction.updateMany({
    where: { id: transactionId },
    data: { guestConfirmationEmailSentAt: null },
  });
}

async function sendTipGuestConfirmationEmail(input: {
  transactionId: string;
  to: string;
  locale: EmailLocale;
  customerName?: string | null;
}): Promise<boolean> {
  const tip = await loadTipConfirmationContext(input.transactionId);
  if (!tip || tip.status !== "success") return false;

  const amountEur = Number(tip.amount);
  const receiptNumber = tip.receiptNumber?.trim() ?? "";
  const employeeName = tip.employee?.name?.trim() ?? "";
  const businessName = tip.business?.name?.trim() ?? "";

  const { subject, html, text } = buildTipGuestConfirmationContent({
    locale: input.locale,
    amountEur,
    employeeName,
    businessName,
    receiptNumber,
    recipientName: input.customerName ?? null,
  });

  const from = getResendFromAddress();
  return sendResendEmail("tip-guest-confirmation", {
    from,
    to: [input.to],
    subject,
    html,
    text,
  });
}

/**
 * Sends at most one guest confirmation email per successful tip.
 * Email failure does not affect tip success; claim is released so Stripe retries can resend.
 */
export async function scheduleTipGuestConfirmationEmailForCheckoutSession(
  transactionId: string,
  session: Stripe.Checkout.Session,
  paymentIntent?: Stripe.PaymentIntent | null,
): Promise<void> {
  const to = resolveGuestEmailFromCheckoutSession(session, paymentIntent);
  if (!to) {
    console.info("[tip-guest-confirmation] skipped_no_email", { transactionId, sessionId: session.id });
    return;
  }

  if (!(await claimGuestConfirmationSend(transactionId))) {
    return;
  }

  const locale = resolveEmailLocaleFromCheckoutSession(session);
  const customerName =
    typeof session.metadata?.customerName === "string" ? session.metadata.customerName.trim() : null;

  try {
    const ok = await sendTipGuestConfirmationEmail({
      transactionId,
      to,
      locale,
      customerName,
    });
    if (!ok) {
      await releaseGuestConfirmationClaim(transactionId);
      console.warn("[tip-guest-confirmation] delivery_failed", { transactionId, sessionId: session.id });
    }
  } catch (err) {
    await releaseGuestConfirmationClaim(transactionId);
    logServerError("tipGuestConfirmationEmail.checkout", err, {
      transactionId,
      sessionId: session.id,
    });
  }
}

export async function scheduleTipGuestConfirmationEmailForPaymentIntent(
  transactionId: string,
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> {
  const to = normalizeGuestEmail(paymentIntent.receipt_email ?? null);
  if (!to) {
    console.info("[tip-guest-confirmation] skipped_no_email_pi", {
      transactionId,
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  if (!(await claimGuestConfirmationSend(transactionId))) {
    return;
  }

  const locale =
    parseTipGuestPresentationLocale(paymentIntent.metadata?.locale ?? null) ??
    resolveEmailLocale({});
  const customerName =
    typeof paymentIntent.metadata?.customerName === "string"
      ? paymentIntent.metadata.customerName.trim()
      : null;

  try {
    const ok = await sendTipGuestConfirmationEmail({
      transactionId,
      to,
      locale,
      customerName,
    });
    if (!ok) {
      await releaseGuestConfirmationClaim(transactionId);
      console.warn("[tip-guest-confirmation] delivery_failed_pi", {
        transactionId,
        paymentIntentId: paymentIntent.id,
      });
    }
  } catch (err) {
    await releaseGuestConfirmationClaim(transactionId);
    logServerError("tipGuestConfirmationEmail.payment_intent", err, {
      transactionId,
      paymentIntentId: paymentIntent.id,
    });
  }
}
