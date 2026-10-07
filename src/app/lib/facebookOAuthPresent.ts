import type { TFunction } from "i18next";
import { toast } from "sonner";
import { isFacebookLoginError, type FacebookLoginFailureKind } from "./facebookLoginError";
import { warmFacebookSdk } from "./facebookOAuthWeb";

export type FacebookOAuthToastAction =
  | { type: "none" }
  | { type: "toast_error"; messageKey: string; toastId: string }
  | { type: "toast_message"; messageKey: string; toastId: string }
  | { type: "provider_not_configured" }
  | { type: "generic_provider_failed" };

/** Maps SDK failure kinds to Phase-Three-ready toast actions (no copy changes here). */
export function facebookLoginErrorToastAction(
  kind: FacebookLoginFailureKind,
): FacebookOAuthToastAction {
  switch (kind) {
    case "cancelled":
    case "concurrent":
      return { type: "none" };
    case "callback_missing_auth":
    case "session_bridge_unverified":
      return {
        type: "toast_error",
        messageKey: "auth.oauth.facebookCallbackMissingAuth",
        toastId: "caretip-fb-callback-missing-auth",
      };
    case "popup_blocked":
    case "popup_unverified":
      return {
        type: "toast_error",
        messageKey: "auth.oauth.facebookPopupBlocked",
        toastId: "caretip-fb-popup-blocked",
      };
    case "sdk_not_ready":
      return {
        type: "toast_message",
        messageKey: "auth.oauth.facebookSdkLoading",
        toastId: "caretip-fb-warm",
      };
    case "not_configured":
      return { type: "provider_not_configured" };
    case "sdk_load_failed":
      return {
        type: "toast_error",
        messageKey: "auth.oauth.facebookSdkLoadFailed",
        toastId: "caretip-fb-load",
      };
    case "incomplete":
      return {
        type: "toast_error",
        messageKey: "auth.oauth.facebookIncomplete",
        toastId: "caretip-fb-incomplete",
      };
    default:
      return { type: "generic_provider_failed" };
  }
}

export function presentFacebookLoginError(
  e: unknown,
  t: TFunction,
  opts?: {
    onSdkWarmRetry?: () => void;
    onNotConfigured?: () => void;
    onGeneric?: (message: string) => void;
  },
): void {
  if (isFacebookLoginError(e)) {
    const action = facebookLoginErrorToastAction(e.kind);
    switch (action.type) {
      case "none":
        return;
      case "toast_error":
        toast.error(t(action.messageKey), { id: action.toastId });
        return;
      case "toast_message":
        toast.message(t(action.messageKey), { id: action.toastId });
        void warmFacebookSdk().then(() => opts?.onSdkWarmRetry?.());
        return;
      case "provider_not_configured":
        opts?.onNotConfigured?.();
        return;
      case "generic_provider_failed":
        opts?.onGeneric?.(t("auth.oauth.providerFailed", { provider: "Facebook" }));
        return;
    }
  }
  opts?.onGeneric?.(t("auth.oauth.providerFailed", { provider: "Facebook" }));
}
