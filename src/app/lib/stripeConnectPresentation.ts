import type { ConnectStatus } from "./api";

/** UI traffic-light only — maps authoritative backend ConnectStatus, does not invent Stripe states. */
export type StripeConnectTrafficLight = "green" | "yellow" | "red";

export function stripeConnectTrafficLight(data: ConnectStatus): StripeConnectTrafficLight {
  if (!data.stripeConfigured || data.status === "not_connected") return "red";
  if (data.status === "ready") return "green";
  return "yellow";
}

export function stripeConnectHeadlineKey(data: ConnectStatus): string {
  const light = stripeConnectTrafficLight(data);
  if (light === "green") return "business.billing.connect.statusReady";
  if (light === "yellow") return "business.billing.connect.statusAttention";
  return "business.billing.connect.statusNotConnected";
}

export function stripeConnectBodyKey(data: ConnectStatus): string {
  const light = stripeConnectTrafficLight(data);
  if (light === "green") return "business.billing.connect.statusReadyBody";
  if (light === "yellow") return "business.billing.connect.nextStepHint";
  return "business.billing.connect.statusNotConnectedBody";
}

export function stripeConnectCtaKey(data: ConnectStatus): string | null {
  const light = stripeConnectTrafficLight(data);
  if (light === "green") return null;
  if (light === "yellow") return "business.billing.connect.continue";
  return "business.billing.connect.connect";
}

export function stripeConnectPrintBadgeKey(data: ConnectStatus): string {
  const light = stripeConnectTrafficLight(data);
  if (light === "green") return "business.qrStudio.print.stripeReady";
  if (light === "yellow") return "business.qrStudio.print.stripeAction";
  return "business.qrStudio.print.stripeDisconnected";
}
