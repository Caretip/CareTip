import type { ReactNode } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { googleOAuthWebClientId } from "@/app/lib/googleOAuthWebClientId";

/**
 * GIS provider for surfaces that render GoogleLogin.
 * Must not wrap the public landing tree — GSI would compete with first paint.
 */
export function AuthGoogleOAuthScope({ children }: { children: ReactNode }) {
  const clientId = googleOAuthWebClientId();
  if (!clientId) return children;
  return <GoogleOAuthProvider clientId={clientId}>{children}</GoogleOAuthProvider>;
}
