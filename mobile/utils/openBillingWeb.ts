import { Platform, Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { t } from "@/i18n";
import { createBillingHandoffSession } from "@/services/api/billingHandoffService";
import { fetchBillingSyncStatus } from "@/services/api/billingSyncService";
import { fetchBusinessProfile } from "@/services/api/businessService";
import { queryClient } from "@/services/api/queryClient";
import { getUserQueryKeys } from "@/services/api/queryKeys";
import {
  invalidateWorkspaceQueries,
  syncAuthUserFromServer,
} from "@/services/api/invalidateUserQueries";
import { useBillingReturnSyncStore } from "@/store/billingReturnSyncStore";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/store/toastStore";
import { normalizeApiError } from "@/types/api";
import { boostForegroundSyncAfterBilling } from "@/utils/billingForegroundBoost";
import {
  BILLING_RETURN_SYNC_INTERVAL_MS,
  BILLING_RETURN_SYNC_MAX_ATTEMPTS,
  didTierUpgrade,
  isBillingEntitlementConfirmed,
} from "@/utils/billingReturnSyncPolicy";

/** Prevents stacked Custom Tabs / SFSafariViewController sessions on double-tap. */
let billingBrowserInFlight: Promise<void> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function confirmLeaveForBillingWeb(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(t("billingHandoff.confirmTitle"), t("billingHandoff.confirmBody"), [
      {
        text: t("billingHandoff.cancel"),
        style: "cancel",
        onPress: () => resolve(false),
      },
      {
        text: t("billingHandoff.continue"),
        style: "default",
        onPress: () => resolve(true),
      },
    ]);
  });
}

async function readCachedOrFetchTier(): Promise<string | null | undefined> {
  const qk = getUserQueryKeys();
  if (qk) {
    const cached = queryClient.getQueryData<{ subscriptionTier?: string | null }>(qk.businessProfile);
    if (cached && "subscriptionTier" in cached) return cached.subscriptionTier;
  }
  try {
    const profile = await fetchBusinessProfile();
    return profile.subscriptionTier;
  } catch {
    return undefined;
  }
}

/**
 * After the in-app browser closes: sync-status (+ activation backup) then profile.
 * Bounded retries — never infinite. Soft outcome when user cancelled / no plan change.
 */
async function syncSubscriptionAfterBillingReturn(
  tierBefore: string | null | undefined,
): Promise<"confirmed" | "unchanged" | "failed"> {
  useBillingReturnSyncStore.getState().begin(t("billingHandoff.updatingPlan"));
  boostForegroundSyncAfterBilling();

  try {
    for (let attempt = 0; attempt < BILLING_RETURN_SYNC_MAX_ATTEMPTS; attempt += 1) {
      try {
        const status = await fetchBillingSyncStatus();
        if (isBillingEntitlementConfirmed(status)) {
          await syncAuthUserFromServer();
          const qk = getUserQueryKeys();
          if (qk) await invalidateWorkspaceQueries(queryClient, qk);
          return "confirmed";
        }
      } catch {
        // Webhook / network may still be in flight.
      }

      try {
        const profile = await fetchBusinessProfile();
        if (
          isBillingEntitlementConfirmed({
            synced: false,
            subscriptionTier: profile.subscriptionTier,
          }) ||
          didTierUpgrade(tierBefore, profile.subscriptionTier)
        ) {
          await syncAuthUserFromServer();
          const qk = getUserQueryKeys();
          if (qk) await invalidateWorkspaceQueries(queryClient, qk);
          return "confirmed";
        }
      } catch {
        /* keep polling */
      }

      if (attempt < BILLING_RETURN_SYNC_MAX_ATTEMPTS - 1) {
        await sleep(BILLING_RETURN_SYNC_INTERVAL_MS);
      }
    }

    // Final refresh so Basic/cancel paths still get fresh profile.
    try {
      await syncAuthUserFromServer();
      const qk = getUserQueryKeys();
      if (qk) await invalidateWorkspaceQueries(queryClient, qk);
      const profile = await fetchBusinessProfile();
      if (
        isBillingEntitlementConfirmed({
          synced: false,
          subscriptionTier: profile.subscriptionTier,
        }) ||
        didTierUpgrade(tierBefore, profile.subscriptionTier)
      ) {
        return "confirmed";
      }
      return "unchanged";
    } catch {
      return "failed";
    }
  } finally {
    useBillingReturnSyncStore.getState().end();
  }
}

export type OpenBillingWebOptions = {
  /** Default true — managers always see the leave-app explanation. */
  confirm?: boolean;
};

/**
 * Opens CareTip web Billing in an authenticated browser session.
 * Uses the mobile→web one-time handoff — never appends the mobile JWT to the URL.
 *
 * Flow: confirm → handoff → Custom Tab / SFSafariViewController → dismiss →
 * bounded sync-status/profile refresh.
 */
export async function openAuthenticatedBillingWeb(
  opts?: OpenBillingWebOptions,
): Promise<void> {
  if (billingBrowserInFlight) {
    return;
  }

  const needsConfirm = opts?.confirm !== false;
  if (needsConfirm) {
    const ok = await confirmLeaveForBillingWeb();
    if (!ok) return;
  }

  billingBrowserInFlight = (async () => {
    const tierBefore = await readCachedOrFetchTier();

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

      const outcome = await syncSubscriptionAfterBillingReturn(tierBefore);
      if (outcome === "confirmed") {
        showSuccessToast(t("billingHandoff.planUpdated"));
      } else if (outcome === "unchanged") {
        showInfoToast(t("billingHandoff.planUnchangedHint"));
      } else {
        showErrorToast(t("billingHandoff.syncFailed"));
      }
    } catch (error) {
      const normalized = normalizeApiError(error);
      const code = normalized.code ?? "";
      const status = normalized.status;
      if (status === 401 || code === "AUTH_REQUIRED") {
        showErrorToast(t("billingHandoff.sessionExpired"));
      } else if (status === 429) {
        showErrorToast(normalized.message || t("billingHandoff.openFailed"));
      } else {
        showErrorToast(normalized.message || t("billingHandoff.openFailed"));
      }
    } finally {
      if (Platform.OS === "android") {
        await WebBrowser.coolDownAsync().catch(() => undefined);
      }
      billingBrowserInFlight = null;
    }
  })();

  await billingBrowserInFlight;
}
