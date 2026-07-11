import wycWebp from "../../images/wyc.webp";
import wycAvif from "../../images/wyc.avif";
import formobile01Jpeg from "../../images/formobile01.jpeg";
import formobile01Webp from "../../images/formobile01.webp";

export type HeroStoryFrame = {
  key: string;
  src: string;
  avif?: string;
  webp?: string;
  mobileSrc?: string;
  mobileWebp?: string;
};

/** First visible hero frame — only assets in the initial landing graph. */
export const LCP_HERO_STORY_FRAME: HeroStoryFrame = {
  key: "wyc",
  src: wycWebp,
  webp: wycWebp,
  avif: wycAvif,
  mobileSrc: formobile01Jpeg,
  mobileWebp: formobile01Webp,
};

/** Matches `<picture>` mobile sources in LandingHeroStoryShowcase. */
export const HERO_LCP_MOBILE_MAX_WIDTH = 767;

/** Desktop LCP — AVIF preferred (same as first `<source type="image/avif">`). */
export const HERO_LCP_DESKTOP_PRELOAD = {
  href: wycAvif,
  type: "image/avif",
  media: "(min-width: 768px)",
} as const;

/** Mobile LCP — WebP preferred (first mobile `<source type="image/webp">`). */
export const HERO_LCP_MOBILE_PRELOAD = {
  href: formobile01Webp,
  type: "image/webp",
  media: "(max-width: 767px)",
} as const;

/** Load the second carousel frame only after the LCP image has painted. */
export async function loadDeferredHeroStoryFrame(): Promise<HeroStoryFrame> {
  const [
    { default: wyoWebp },
    { default: wyoAvif },
    { default: formobile02Jpeg },
    { default: formobile02Webp },
  ] = await Promise.all([
    import("../../images/wyo.webp"),
    import("../../images/wyo.avif"),
    import("../../images/formobile02.jpeg"),
    import("../../images/formobile02.webp"),
  ]);

  return {
    key: "wyo",
    src: wyoWebp,
    webp: wyoWebp,
    avif: wyoAvif,
    mobileSrc: formobile02Jpeg,
    mobileWebp: formobile02Webp,
  };
}

export function heroFramePreloadSrc(frame: HeroStoryFrame): string {
  if (
    typeof window !== "undefined" &&
    window.matchMedia(`(max-width: ${HERO_LCP_MOBILE_MAX_WIDTH}px)`).matches
  ) {
    return frame.mobileWebp ?? frame.mobileSrc ?? frame.webp ?? frame.src;
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
