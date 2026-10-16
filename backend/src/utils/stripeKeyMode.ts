export type StripeSecretKeyMode = "test" | "live" | "missing" | "invalid";

export function stripeSecretKeyMode(): StripeSecretKeyMode {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (!key) return "missing";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("sk_live_")) return "live";
  return "invalid";
}

export function assertStripeSecretKeyModeUsable(): StripeSecretKeyMode {
  const mode = stripeSecretKeyMode();
  if (mode === "test" || mode === "live") return mode;
  throw new Error("STRIPE_SECRET_KEY missing or invalid prefix");
}

export function stripeKeyModeMatchesAccountLivemode(livemode: boolean): boolean {
  const mode = stripeSecretKeyMode();
  if (mode === "test") return livemode === false;
  if (mode === "live") return livemode === true;
  return false;
}
