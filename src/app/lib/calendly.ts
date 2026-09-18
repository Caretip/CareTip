/**
 * CareTip Calendly booking popup — single shared loader + open helper.
 * URL: https://calendly.com/caretip-info/30min
 */

export const CARETIP_CALENDLY_URL = "https://calendly.com/caretip-info/30min";

const CALENDLY_SCRIPT_SRC = "https://assets.calendly.com/assets/external/widget.js";
const CALENDLY_STYLE_HREF = "https://assets.calendly.com/assets/external/widget.css";
const SCRIPT_ATTR = "data-caretip-calendly-script";
const STYLE_ATTR = "data-caretip-calendly-style";

type CalendlyApi = {
  initPopupWidget: (opts: { url: string }) => void;
};

declare global {
  interface Window {
    Calendly?: CalendlyApi;
  }
}

let assetsPromise: Promise<CalendlyApi> | null = null;
let popupInFlight = false;

function ensureStylesheet(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`link[${STYLE_ATTR}]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CALENDLY_STYLE_HREF;
  link.setAttribute(STYLE_ATTR, "1");
  document.head.appendChild(link);
}

function loadCalendlyAssets(): Promise<CalendlyApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Calendly requires a browser"));
  }
  if (window.Calendly?.initPopupWidget) {
    ensureStylesheet();
    return Promise.resolve(window.Calendly);
  }
  if (assetsPromise) return assetsPromise;

  ensureStylesheet();

  assetsPromise = new Promise<CalendlyApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`);
    if (existing) {
      const finish = () => {
        if (window.Calendly?.initPopupWidget) resolve(window.Calendly);
        else reject(new Error("Calendly script present but API missing"));
      };
      if (window.Calendly?.initPopupWidget) {
        finish();
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => {
          assetsPromise = null;
          reject(new Error("Calendly script failed to load"));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = CALENDLY_SCRIPT_SRC;
    script.async = true;
    script.setAttribute(SCRIPT_ATTR, "1");
    script.onload = () => {
      if (window.Calendly?.initPopupWidget) resolve(window.Calendly);
      else {
        assetsPromise = null;
        reject(new Error("Calendly API missing after load"));
      }
    };
    script.onerror = () => {
      assetsPromise = null;
      reject(new Error("Calendly script failed to load"));
    };
    document.head.appendChild(script);
  });

  return assetsPromise;
}

/** Open booking page in a new tab (fallback when the popup widget cannot load). */
export function openCareTipCalendlyFallback(): void {
  if (typeof window === "undefined") return;
  window.open(CARETIP_CALENDLY_URL, "_blank", "noopener,noreferrer");
}

/**
 * Open the CareTip Calendly popup. Loads widget assets at most once.
 * On failure, opens the same URL in a new tab.
 */
export async function openCareTipCalendlyPopup(): Promise<void> {
  if (typeof window === "undefined") return;
  if (popupInFlight) return;
  popupInFlight = true;
  try {
    const calendly = await loadCalendlyAssets();
    calendly.initPopupWidget({ url: CARETIP_CALENDLY_URL });
  } catch {
    openCareTipCalendlyFallback();
  } finally {
    // Short lock avoids double-init from rapid double-clicks; Calendly manages its own overlay.
    window.setTimeout(() => {
      popupInFlight = false;
    }, 600);
  }
}

/** Test helper — reset module state between unit checks. */
export function resetCareTipCalendlyLoaderForTests(): void {
  assetsPromise = null;
  popupInFlight = false;
}
