import { useCallback, useEffect, useState } from "react";
import { readCookieConsent, writeCookieConsent } from "@/utils/cookieConsent";

export function useCookieConsent() {
  const [bannerVisible, setBannerVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void readCookieConsent().then((stored) => {
      if (!mounted) return;
      setBannerVisible(stored == null);
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const acceptAll = useCallback(async () => {
    await writeCookieConsent({ analytics: true, functional: true, marketing: true });
    setBannerVisible(false);
  }, []);

  const rejectNonEssential = useCallback(async () => {
    await writeCookieConsent({ analytics: false, functional: false, marketing: false });
    setBannerVisible(false);
  }, []);

  return {
    bannerVisible: ready && bannerVisible,
    acceptAll,
    rejectNonEssential,
  };
}
