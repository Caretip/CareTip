import type { ReactNode } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { useTranslation } from "react-i18next";
import { googleOAuthWebClientId } from "@/app/lib/googleOAuthWebClientId";

/**
 * GIS provider for surfaces that render GoogleLogin.
 * Must not wrap the public landing tree — GSI would compete with first paint.
 */
export function AuthGoogleOAuthScope({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const clientId = googleOAuthWebClientId();
  if (!clientId) return children;
  const locale = i18n.language?.toLowerCase().startsWith("de") ? "de" : "en";
  return (
    <GoogleOAuthProvider clientId={clientId} locale={locale}>
      {children}
    </GoogleOAuthProvider>
  );
}
