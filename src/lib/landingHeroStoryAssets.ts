import wycWebp from "../../images/wyc.webp";
import wycAvif from "../../images/wyc.avif";
import formemobile01Jpeg from "../../images/formemobile01.jpeg";
import formemobile01Webp from "../../images/formemobile01.webp";
import formemobile01Avif from "../../images/formemobile01.avif";

export type HeroStoryFrame = {
  key: string;
  src: string;
  avif?: string;
  webp?: string;
  mobileSrc?: string;
  mobileWebp?: string;
  mobileAvif?: string;
};

/** First visible hero frame — only assets in the initial landing graph. */
export const LCP_HERO_STORY_FRAME: HeroStoryFrame = {
  key: "wyc",
  src: wycWebp,
  webp: wycWebp,
  avif: wycAvif,
  mobileSrc: formemobile01Jpeg,
  mobileWebp: formemobile01Webp,
  mobileAvif: formemobile01Avif,
};

/** Matches `<picture>` mobile sources in LandingHeroStoryShowcase. */
export const HERO_LCP_MOBILE_MAX_WIDTH = 767;

/** Desktop LCP — AVIF preferred (same as first `<source type="image/avif">`). */
export const HERO_LCP_DESKTOP_PRELOAD = {
  href: wycAvif,
  type: "image/avif",
  media: "(min-width: 768px)",
} as const;

/** Mobile LCP — AVIF preferred when available (first mobile `<source type="image/avif">`). */
export const HERO_LCP_MOBILE_PRELOAD = {
  href: formemobile01Avif,
  type: "image/avif",
  media: "(max-width: 767px)",
} as const;

const HERO_LCP_PRELOAD_ATTR = "data-caretip-hero-lcp-preload";

/** Keep decoded bitmaps reachable so revisiting `/` can reuse them from memory. */
const warmImageBySrc = new Map<string, HTMLImageElement>();
let warmLcpPromise: Promise<void> | null = null;

function isMobileHeroViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia(`(max-width: ${HERO_LCP_MOBILE_MAX_WIDTH}px)`).matches
  );
}

export function getLandingHeroLcpPreload(): { href: string; type: string; media: string } {
  return isMobileHeroViewport() ? HERO_LCP_MOBILE_PRELOAD : HERO_LCP_DESKTOP_PRELOAD;
}

/** Inject / refresh a document preload so SPA navigations match cold `index.html` hints. */
export function ensureLandingHeroLcpPreloadLink(): void {
  if (typeof document === "undefined") return;

  const { href, type, media } = getLandingHeroLcpPreload();
  let link = document.head.querySelector<HTMLLinkElement>(`link[${HERO_LCP_PRELOAD_ATTR}]`);

  if (!link) {
    link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.setAttribute(HERO_LCP_PRELOAD_ATTR, "1");
    document.head.appendChild(link);
  }

  if (link.href !== new URL(href, document.baseURI).href) {
    link.href = href;
  }
  link.type = type;
  link.media = media;
  link.setAttribute("fetchpriority", "high");
}

export function isLandingHeroLcpWarm(): boolean {
  if (typeof window === "undefined") return false;
  const { href } = getLandingHeroLcpPreload();
  const warm = warmImageBySrc.get(href);
  if (warm?.complete && warm.naturalWidth > 0) return true;

  const domImg = document.querySelector('[data-hero-frame="wyc"] img');
  return (
    domImg instanceof HTMLImageElement &&
    domImg.complete &&
    domImg.naturalWidth > 0
  );
}

/**
 * Fetch + decode the viewport LCP hero early and keep it in a session Map.
 * Safe to call repeatedly — shares one in-flight promise per navigation burst.
 */
export function warmLandingHeroLcpImage(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  ensureLandingHeroLcpPreloadLink();
  const { href } = getLandingHeroLcpPreload();
  const existing = warmImageBySrc.get(href);
  if (existing?.complete && existing.naturalWidth > 0) {
    return Promise.resolve();
  }

  if (warmLcpPromise) return warmLcpPromise;

  warmLcpPromise = new Promise<void>((resolve) => {
    const img = new Image();
    img.setAttribute("fetchpriority", "high");
    img.decoding = "async";

    const finish = () => {
      warmImageBySrc.set(href, img);
      resolve();
    };

    const failToWebp = () => {
      const fallbackHref =
        (isMobileHeroViewport()
          ? LCP_HERO_STORY_FRAME.mobileWebp
          : LCP_HERO_STORY_FRAME.webp) ?? LCP_HERO_STORY_FRAME.src;
      const fallback = new Image();
      fallback.setAttribute("fetchpriority", "high");
      fallback.onload = () => {
        warmImageBySrc.set(href, fallback);
        warmImageBySrc.set(fallbackHref, fallback);
        resolve();
      };
      fallback.onerror = () => resolve();
      fallback.src = fallbackHref;
    };

    img.onload = () => {
      if (typeof img.decode === "function") {
        void img.decode().then(finish, finish);
      } else {
        finish();
      }
    };
    img.onerror = failToWebp;
    img.src = href;
  }).finally(() => {
    warmLcpPromise = null;
  });

  return warmLcpPromise;
}

/** Load the second carousel frame only after the LCP image has painted. */
export async function loadDeferredHeroStoryFrame(): Promise<HeroStoryFrame> {
  const [
    { default: wyoWebp },
    { default: wyoAvif },
    { default: formemobile02Jpeg },
    { default: formemobile02Webp },
    { default: formemobile02Avif },
  ] = await Promise.all([
    import("../../images/wyo.webp"),
    import("../../images/wyo.avif"),
    import("../../images/formemobile02.jpeg"),
    import("../../images/formemobile02.webp"),
    import("../../images/formemobile02.avif"),
  ]);

  return {
    key: "wyo",
    src: wyoWebp,
    webp: wyoWebp,
    avif: wyoAvif,
    mobileSrc: formemobile02Jpeg,
    mobileWebp: formemobile02Webp,
    mobileAvif: formemobile02Avif,
  };
}

export function heroFramePreloadSrc(frame: HeroStoryFrame): string {
  if (isMobileHeroViewport()) {
    return frame.mobileAvif ?? frame.mobileWebp ?? frame.mobileSrc ?? frame.webp ?? frame.src;
  }
  return frame.avif ?? frame.webp ?? frame.src;
}

export function preloadHeroFrame(frame: HeroStoryFrame, onReady?: () => void): void {
  const img = new Image();
  const finish = () => onReady?.();
  img.onload = finish;
  img.onerror = () => {
    const fallback = new Image();
    fallback.onload = finish;
    fallback.onerror = finish;
    fallback.src = frame.webp ?? frame.mobileWebp ?? frame.mobileSrc ?? frame.src;
  };
  img.src = heroFramePreloadSrc(frame);
}

/** Start warming as soon as this module evaluates (LandingPage / prefetch import). */
if (typeof window !== "undefined") {
  void warmLandingHeroLcpImage();
}
