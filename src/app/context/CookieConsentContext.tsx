import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ACCEPT_ALL_CONSENT,
  COOKIE_CONSENT_CHANGED_EVENT,
  COOKIE_CONSENT_OPEN_EVENT,
  emitCookieConsentChanged,
  readCookieConsent,
  writeCookieConsent,
  type CookieConsentRecord,
} from "../lib/cookieConsent";
import { applyCookieConsentScripts } from "../lib/cookieConsentScripts";

type CookieConsentContextValue = {
  consent: CookieConsentRecord | null;
  bannerVisible: boolean;
  settingsOpen: boolean;
  acceptAll: () => void;
  rejectNonEssential: () => void;
  savePreferences: (prefs: Pick<CookieConsentRecord, "analytics" | "functional" | "marketing">) => void;
  openSettings: () => void;
  closeSettings: () => void;
};

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

function persistAndApply(prefs: Pick<CookieConsentRecord, "analytics" | "functional" | "marketing">) {
  const record = writeCookieConsent(prefs);
  applyCookieConsentScripts(record);
  emitCookieConsentChanged(record);
  return record;
}

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsent] = useState<CookieConsentRecord | null>(() => readCookieConsent());
  const [bannerVisible, setBannerVisible] = useState(() => readCookieConsent() == null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const stored = readCookieConsent();
    if (stored) {
      applyCookieConsentScripts(stored);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setSettingsOpen(true);
      setBannerVisible(false);
    };
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<CookieConsentRecord>).detail;
      if (detail) setConsent(detail);
    };
    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpen);
    window.addEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChanged as EventListener);
    return () => {
      window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, onOpen);
      window.removeEventListener(COOKIE_CONSENT_CHANGED_EVENT, onChanged as EventListener);
    };
  }, []);

  const acceptAll = useCallback(() => {
    const record = persistAndApply(ACCEPT_ALL_CONSENT);
    setConsent(record);
    setBannerVisible(false);
    setSettingsOpen(false);
  }, []);

  const rejectNonEssential = useCallback(() => {
    const record = persistAndApply({ analytics: false, functional: false, marketing: false });
    setConsent(record);
    setBannerVisible(false);
    setSettingsOpen(false);
  }, []);

  const savePreferences = useCallback(
    (prefs: Pick<CookieConsentRecord, "analytics" | "functional" | "marketing">) => {
      const record = persistAndApply(prefs);
      setConsent(record);
      setBannerVisible(false);
      setSettingsOpen(false);
    },
    [],
  );

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    setBannerVisible(false);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (!readCookieConsent()) setBannerVisible(true);
  }, []);

  const value = useMemo(
    () => ({
      consent,
      bannerVisible,
      settingsOpen,
      acceptAll,
      rejectNonEssential,
      savePreferences,
      openSettings,
      closeSettings,
    }),
    [
      consent,
      bannerVisible,
      settingsOpen,
      acceptAll,
      rejectNonEssential,
      savePreferences,
      openSettings,
      closeSettings,
    ],
  );

  return <CookieConsentContext.Provider value={value}>{children}</CookieConsentContext.Provider>;
}

export function useCookieConsent(): CookieConsentContextValue {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) {
    throw new Error("useCookieConsent must be used within CookieConsentProvider");
  }
  return ctx;
}
