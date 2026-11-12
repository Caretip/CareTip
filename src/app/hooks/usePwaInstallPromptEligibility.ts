import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useCookieConsent } from "@/app/context/CookieConsentContext";

/**
 * Install is only offered where it helps: the landing page and the signed-in app areas. Never on
 * sign-in, guest tipping or checkout screens, where a fixed bottom banner covers primary actions
 * (it hid the Google sign-in button on iPhone-sized screens).
 */
export function isPwaInstallPromptRoute(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return true;
  if (/^\/(employee|platform-admin)\/(login|signup)$/.test(p)) return false;
  return /^\/(dashboard|employee|employee-dashboard|business-dashboard|business\/dashboard|platform-admin)(\/|$)/.test(p);
}

/**
 * PWA install is lower priority than cookie consent. Eligible only after consent is
 * stored, and — for visitors who resolve consent this session — after the next
 * meaningful interaction or in-app navigation (not the same moment the banner closes).
 */
export function usePwaInstallPromptEligibility(): boolean {
  const { consent } = useCookieConsent();
  const location = useLocation();
  const pathnameRef = useRef(location.pathname);
  pathnameRef.current = location.pathname;

  const hadConsentOnMount = useRef<boolean | null>(null);
  if (hadConsentOnMount.current === null) {
    hadConsentOnMount.current = consent != null;
  }
  const [unlocked, setUnlocked] = useState(() => hadConsentOnMount.current === true);
  const pathWhenConsentResolvedRef = useRef<string | null>(null);
  const consentResolvedThisSessionRef = useRef(consent != null);

  useEffect(() => {
    if (consent == null) {
      setUnlocked(false);
      pathWhenConsentResolvedRef.current = null;
      consentResolvedThisSessionRef.current = false;
      return;
    }
    if (hadConsentOnMount.current) {
      setUnlocked(true);
      return;
    }
    if (consentResolvedThisSessionRef.current) return;

    consentResolvedThisSessionRef.current = true;
    pathWhenConsentResolvedRef.current = pathnameRef.current;
    setUnlocked(false);

    const unlock = () => setUnlocked(true);
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    window.addEventListener("keydown", unlock, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [consent]);

  useEffect(() => {
    if (consent == null || hadConsentOnMount.current || unlocked) return;
    const baseline = pathWhenConsentResolvedRef.current;
    if (baseline != null && location.pathname !== baseline) {
      setUnlocked(true);
    }
  }, [location.pathname, consent, unlocked]);

  return consent != null && unlocked && isPwaInstallPromptRoute(location.pathname);
}
