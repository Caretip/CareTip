import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export type OAuthProgressProvider = "google" | "apple" | "facebook";

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * Deliberate "signing you in with Google" state for the whole credential exchange — from the first
 * paint after returning from Google (redirect mode) or the moment the popup hands back a credential,
 * until the post-sign-in cover takes over at navigation. It covers the auth form (which stays mounted,
 * so an error returns to the exact form state) instead of letting the form flash back into view.
 * Not the CareTip page loader: it names the provider and sits inside the auth page.
 */
export function AuthOAuthProgress({ provider }: { provider: OAuthProgressProvider }) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Screen readers and keyboard users land on the status instead of a hidden form field.
    titleRef.current?.focus();
  }, []);

  const providerName =
    provider === "google" ? "Google" : provider === "apple" ? "Apple" : "Facebook";

  return (
    <div
      className="caretip-oauth-progress fixed inset-0 z-[60] flex items-center justify-center bg-background px-6"
      data-oauth-progress={provider}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex max-w-xs flex-col items-center gap-5 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center">
          <span
            className="absolute inset-0 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none"
            aria-hidden
          />
          {provider === "google" ? (
            <GoogleMark className="h-7 w-7" />
          ) : (
            <span className="text-sm font-semibold text-foreground" aria-hidden>
              {providerName.charAt(0)}
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          <p ref={titleRef} tabIndex={-1} className="text-base font-semibold text-foreground outline-none">
            {t("auth.oauth.progress.title", { provider: providerName })}
          </p>
          <p className="text-sm text-muted-foreground">{t("auth.oauth.progress.hint")}</p>
        </div>
      </div>
    </div>
  );
}
