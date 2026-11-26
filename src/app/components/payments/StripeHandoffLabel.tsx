import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Busy content for a button that is preparing a Stripe hand-off. Shown on the button itself while
 * the page stays visible: the server is creating the Checkout (or billing portal) session, then
 * the browser opens Stripe. Never a full-screen overlay.
 */
export function StripeHandoffLabel({ kind = "checkout" }: { kind?: "checkout" | "portal" }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex min-w-0 items-center justify-center gap-2">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      <span className="min-w-0 whitespace-normal text-center leading-tight">
        {t(kind === "portal" ? "common.loading.billingPortal" : "common.loading.checkoutButton")}
      </span>
    </span>
  );
}
