import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { createBillingHandoffSession } from "@/services/api/billingHandoffService";
import { showErrorToast } from "@/store/toastStore";
import { normalizeApiError } from "@/types/api";

/** Prevents stacked Custom Tabs / SFSafariViewController sessions on double-tap. */
let billingBrowserInFlight: Promise<void> | null = null;

/**
 * Opens CareTip web Billing in an authenticated browser session.
 * Uses the mobile→web one-time handoff — never appends the mobile JWT to the URL.
 *
 * `openBrowserAsync` resolves when the user dismisses the in-app browser
 * (Android Custom Tabs / iOS SFSafariViewController), so the app does not
 * wait indefinitely after the tab is closed.
 */
export async function openAuthenticatedBillingWeb(): Promise<void> {
  if (billingBrowserInFlight) {
    return;
  }

  billingBrowserInFlight = (async () => {
    try {
      if (Platform.OS === "android") {
        await WebBrowser.warmUpAsync().catch(() => undefined);
      }

      const session = await createBillingHandoffSession();
      await WebBrowser.openBrowserAsync(session.url, {
        dismissButtonStyle: "close",
        showTitle: true,
        enableDefaultShareMenuItem: false,
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });
    } catch (error) {
      const normalized = normalizeApiError(error);
      showErrorToast(
        normalized.message || "Could not open Billing. Check your connection and try again.",
      );
    } finally {
      if (Platform.OS === "android") {
        await WebBrowser.coolDownAsync().catch(() => undefined);
      }
      billingBrowserInFlight = null;
    }
  })();

  await billingBrowserInFlight;
}
