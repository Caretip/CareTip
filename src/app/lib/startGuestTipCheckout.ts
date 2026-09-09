import { toast } from "sonner";
import { createTipCheckoutSession } from "./api";
import { logClientError } from "./clientLog";
import { toUserFriendlyMessage } from "./errorMessages";
import { setPendingTipFromCheckout } from "./repeatTip";
import { performExternalStripeRedirect } from "./safeCheckoutRedirect";

export type GuestTipCheckoutInput = {
  amount: number;
  employeeId: string;
  businessId: string;
  employeeName?: string | null;
  locationId?: string | null;
  tableId?: string | null;
};

/**
 * Create a guest Checkout Session (server-owned fees/destination) and hand off to Stripe.
 * Returns whether the browser left CareTip for hosted Checkout.
 */
export async function startGuestTipCheckout(
  input: GuestTipCheckoutInput,
  checkoutStartErrorMessage: string,
): Promise<"redirected" | "failed"> {
  try {
    const { sessionId, url } = await createTipCheckoutSession({
      amount: input.amount,
      employeeId: input.employeeId,
      businessId: input.businessId,
      tipAmount: input.amount,
      locationId: input.locationId ?? null,
      tableId: input.tableId ?? null,
    });
    if (!url) {
      toast.error(checkoutStartErrorMessage);
      return "failed";
    }
    setPendingTipFromCheckout({
      sessionId,
      businessId: input.businessId,
      employeeId: input.employeeId,
      employeeName: input.employeeName ?? null,
      amount: input.amount,
    });
    const redirect = performExternalStripeRedirect(url, "checkout");
    if (!redirect.ok) {
      toast.error(checkoutStartErrorMessage);
      return "failed";
    }
    return "redirected";
  } catch (err) {
    logClientError("startGuestTipCheckout", err);
    toast.error(toUserFriendlyMessage(err));
    return "failed";
  }
}
