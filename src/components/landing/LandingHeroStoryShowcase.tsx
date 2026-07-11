import { useCallback, useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";

import { LandingHeroFloatingCards } from "@/components/landing/LandingHeroFloatingCards";
import { landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

import wycWebp from "../../../images/wyc.webp";
import wycAvif from "../../../images/wyc.avif";
import wyoWebp from "../../../images/wyo.webp";
import wyoAvif from "../../../images/wyo.avif";
import formobile01Jpeg from "../../../images/formobile01.jpeg";
import formobile01Webp from "../../../images/formobile01.webp";
import formobile02Jpeg from "../../../images/formobile02.jpeg";
import formobile02Webp from "../../../images/formobile02.webp";

type HeroStoryFrame = {
  key: string;
  src: string;
  avif?: string;
  webp?: string;
  mobileSrc?: string;
  mobileWebp?: string;
};

const STORY_FRAMES: readonly HeroStoryFrame[] = [
  {
    key: "wyc",
    src: wycWebp,
    webp: wycWebp,
    avif: wycAvif,
    mobileSrc: formobile01Jpeg,
    mobileWebp: formobile01Webp,
  },
  {
    key: "wyo",
    src: wyoWebp,
    webp: wyoWebp,
    avif: wyoAvif,
    mobileSrc: formobile02Jpeg,
    mobileWebp: formobile02Webp,
  },
];

const STORY_CYCLE_MS = 5600;
const BG_CROSSFADE_MS = 900;
const HERO_IMAGE_SIZES_CARD = "(max-width: 1023px) min(90vw, 448px), 672px";
const HERO_IMAGE_SIZES_BACKGROUND = "100vw";

function heroFramePreloadSrc(frame: HeroStoryFrame) {
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
    return frame.mobileWebp ?? frame.mobileSrc ?? frame.webp ?? frame.src;
  }
  return frame.webp ?? frame.src;
}

function preloadHeroFrame(
  frame: HeroStoryFrame,
  onReady?: () => void,
) {
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

type LandingHeroStoryShowcaseProps = {
  alt: string;
  className?: string;
  /** `background` = full-bleed hero stack; `card` = legacy framed showcase. */
  variant?: "background" | "card";
  /** Notified when the visible story frame changes (for synced float metrics). */
  onActiveFrameChange?: (frameKey: string) => void;
};

/**
 * Hero story frames — layered crossfade.
 * Background: cover fill; outgoing frame stays visible until incoming finishes fading in.
 */
export function LandingHeroStoryShowcase({
  alt,
  className,
  variant = "card",
  onActiveFrameChange,
}: LandingHeroStoryShowcaseProps) {
  const isBackground = variant === "background";
  const reduceMotion = usePrefersReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null);
  const [frameReady, setFrameReady] = useState<Record<string, boolean>>({});
  const frameReadyRef = useRef(frameReady);
  const transitionTimerRef = useRef<number | null>(null);
  const imageSizes = isBackground ? HERO_IMAGE_SIZES_BACKGROUND : HERO_IMAGE_SIZES_CARD;
  const activeFrameKey = STORY_FRAMES[activeIndex]?.key ?? STORY_FRAMES[0].key;

  const markFrameReady = useCallback((key: string) => {
    setFrameReady((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true };
      frameReadyRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    frameReadyRef.current = frameReady;
  }, [frameReady]);

  useEffect(() => {
    onActiveFrameChange?.(activeFrameKey);
  }, [activeFrameKey, onActiveFrameChange]);

  useEffect(() => {
    if (reduceMotion) return;

    const preloadSecondary = () => {
      STORY_FRAMES.forEach((frame, index) => {
        if (index === 0) return;
        preloadHeroFrame(frame, () => markFrameReady(frame.key));
      });
    };

    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preloadSecondary, { timeout: 4000 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timer = window.setTimeout(preloadSecondary, 2000);
    return () => window.clearTimeout(timer);
  }, [markFrameReady, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || STORY_FRAMES.length < 2) return;

    const timer = window.setInterval(() => {
      if (isBackground && incomingIndex !== null) return;

      const nextIndex = (activeIndex + 1) % STORY_FRAMES.length;
      const nextFrame = STORY_FRAMES[nextIndex];
      if (!frameReadyRef.current[nextFrame.key]) {
        preloadHeroFrame(nextFrame, () => markFrameReady(nextFrame.key));
        return;
      }

      if (isBackground) {
        setIncomingIndex(nextIndex);
        setActiveIndex(nextIndex);
        if (transitionTimerRef.current !== null) {
          window.clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = window.setTimeout(() => {
          setDisplayedIndex(nextIndex);
          setIncomingIndex(null);
          transitionTimerRef.current = null;
        }, BG_CROSSFADE_MS);
      } else {
        setActiveIndex(nextIndex);
      }
    }, STORY_CYCLE_MS);

    return () => window.clearInterval(timer);
  }, [reduceMotion, markFrameReady, activeIndex, incomingIndex, isBackground]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const frames = reduceMotion ? STORY_FRAMES.slice(0, 1) : STORY_FRAMES;

  return (
    <div
      className={cn(
        "caretip-hero-story-showcase-root",
        isBackground && "caretip-hero-story-showcase-root--background",
        className,
      )}
    >
      <div
        className={cn(
          landingUi.heroMediaShell,
          "caretip-hero-showcase-composition",
          isBackground && "caretip-hero-showcase-composition--background",
        )}
      >
        {!isBackground ? (
          <div
            aria-hidden
            className="caretip-hero-showcase-ambient pointer-events-none absolute inset-0 -z-[1]"
          />
        ) : null}

        <div className={cn(landingUi.heroMediaWrap, isBackground && "caretip-hero-media-wrap--background")}>
          <div
            className={cn(
              landingUi.heroMediaClip,
              isBackground && "caretip-hero-media-clip--background",
            )}
          >
            {frames.map((frame, index) => {
              const isCardActive = index === activeIndex;
              const isDisplayed = isBackground ? index === displayedIndex : isCardActive;
              const isIncoming = isBackground && index === incomingIndex;
              const isReady = frameReady[frame.key] ?? index === 0;
              const isVisible = isDisplayed || isIncoming || isCardActive;

              if (
                index > 0 &&
                !isReady &&
                !isDisplayed &&
                !isIncoming &&
                !isCardActive
              ) {
                return null;
              }

              return (
                <picture
                  key={frame.key}
                  className={isBackground ? "caretip-hero-bg-frame-layer" : "contents"}
                  data-hero-frame={frame.key}
                >
                  {frame.mobileWebp ? (
                    <source media="(max-width: 767px)" type="image/webp" srcSet={frame.mobileWebp} />
                  ) : null}
                  {frame.mobileSrc ? (
                    <source media="(max-width: 767px)" srcSet={frame.mobileSrc} />
                  ) : null}
                  {frame.avif ? <source type="image/avif" srcSet={frame.avif} /> : null}
                  {frame.webp ? <source type="image/webp" srcSet={frame.webp} /> : null}
                  <img
                    src={frame.webp ?? frame.src}
                    alt={isVisible ? alt : ""}
                    aria-hidden={!isVisible}
                    className={cn(
                      landingUi.heroShowcaseImg,
                      "caretip-hero-story-frame",
                      isBackground
                        ? "caretip-hero-story-frame--bg-cover"
                        : "caretip-marketing-img",
                      !isBackground && isReady && "caretip-marketing-img--ready",
                      isBackground && isDisplayed && "caretip-hero-story-frame--displayed",
                      isBackground && isIncoming && "caretip-hero-story-frame--incoming",
                      !isBackground && isCardActive && "caretip-hero-story-frame--active",
                      isReady && "caretip-hero-story-frame--ready",
                    )}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    sizes={imageSizes}
                    onLoad={() => markFrameReady(frame.key)}
                    {...(index === 0
                      ? ({ fetchpriority: "high" } as ImgHTMLAttributes<HTMLImageElement>)
                      : ({ fetchpriority: "low" } as ImgHTMLAttributes<HTMLImageElement>))}
                  />
                </picture>
              );
            })}
            {!isBackground ? (
              <div aria-hidden className="caretip-hero-media-tone pointer-events-none" />
            ) : null}
          </div>
        </div>

        {!isBackground ? (
          <div
            className={cn(landingUi.heroFloatLayer, "caretip-hero-float-layer--on-art")}
            data-hero-slide={activeFrameKey}
          >
            <LandingHeroFloatingCards activeFrameKey={activeFrameKey} variant="card" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
