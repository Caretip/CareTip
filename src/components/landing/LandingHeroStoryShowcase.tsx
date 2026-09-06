import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import {
  LCP_HERO_STORY_FRAME,
  isLandingHeroLcpWarm,
  loadDeferredHeroStoryFrame,
  preloadHeroFrame,
  warmLandingHeroLcpImage,
  type HeroStoryFrame,
} from "@/lib/landingHeroStoryAssets";

import { LandingHeroFloatingCards } from "@/components/landing/LandingHeroFloatingCards";
import { landingUi } from "@/components/landing/landingUi";
import { cn } from "@/lib/utils";

const STORY_CYCLE_MS = 5600;
const BG_CROSSFADE_MS = 900;
const HERO_IMAGE_SIZES_CARD = "(max-width: 1023px) min(90vw, 448px), 672px";
const HERO_IMAGE_SIZES_BACKGROUND = "100vw";

type LandingHeroStoryShowcaseProps = {
  alt: string;
  className?: string;
  /** `background` = full-bleed hero stack; `card` = legacy framed showcase. */
  variant?: "background" | "card";
  /** Notified when the visible story frame changes (for synced float metrics). */
  onActiveFrameChange?: (frameKey: string) => void;
  /** Fired once the LCP frame is loaded/decoded (or already complete). */
  onLcpReady?: () => void;
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
  onLcpReady,
}: LandingHeroStoryShowcaseProps) {
  const isBackground = variant === "background";
  const reduceMotion = usePrefersReducedMotion();
  const [storyFrames, setStoryFrames] = useState<readonly HeroStoryFrame[]>(() => [
    LCP_HERO_STORY_FRAME,
  ]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [incomingIndex, setIncomingIndex] = useState<number | null>(null);
  const [frameReady, setFrameReady] = useState<Record<string, boolean>>(() =>
    isLandingHeroLcpWarm() ? { [LCP_HERO_STORY_FRAME.key]: true } : {},
  );
  const [lcpComplete, setLcpComplete] = useState(() => isLandingHeroLcpWarm());
  const lcpImgRef = useRef<HTMLImageElement | null>(null);
  const frameReadyRef = useRef(frameReady);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredFrameLoadRef = useRef<Promise<void> | null>(null);
  const onLcpReadyRef = useRef(onLcpReady);
  const imageSizes = isBackground ? HERO_IMAGE_SIZES_BACKGROUND : HERO_IMAGE_SIZES_CARD;
  const activeFrameKey = storyFrames[activeIndex]?.key ?? LCP_HERO_STORY_FRAME.key;

  useEffect(() => {
    onLcpReadyRef.current = onLcpReady;
  }, [onLcpReady]);

  const markFrameReady = useCallback((key: string) => {
    setFrameReady((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true };
      frameReadyRef.current = next;
      return next;
    });
  }, []);

  const handleLcpFrameLoad = useCallback(() => {
    markFrameReady(LCP_HERO_STORY_FRAME.key);
    setLcpComplete(true);
    onLcpReadyRef.current?.();
  }, [markFrameReady]);

  useEffect(() => {
    frameReadyRef.current = frameReady;
  }, [frameReady]);

  useEffect(() => {
    onActiveFrameChange?.(activeFrameKey);
  }, [activeFrameKey, onActiveFrameChange]);

  useEffect(() => {
    void warmLandingHeroLcpImage();
  }, []);

  useLayoutEffect(() => {
    if (lcpComplete) return;

    const lcpPicture = lcpImgRef.current ?? document.querySelector('[data-hero-frame="wyc"] img');
    if (
      lcpPicture instanceof HTMLImageElement &&
      lcpPicture.complete &&
      lcpPicture.naturalWidth > 0
    ) {
      handleLcpFrameLoad();
      return;
    }

    if (isLandingHeroLcpWarm()) {
      handleLcpFrameLoad();
    }
  }, [handleLcpFrameLoad, lcpComplete]);

  useEffect(() => {
    if (reduceMotion || !lcpComplete || storyFrames.length > 1) return;

    if (!deferredFrameLoadRef.current) {
      deferredFrameLoadRef.current = loadDeferredHeroStoryFrame()
        .then((deferredFrame) => {
          setStoryFrames([LCP_HERO_STORY_FRAME, deferredFrame]);
          preloadHeroFrame(deferredFrame, () => markFrameReady(deferredFrame.key));
        })
        .catch(() => undefined);
    }
  }, [lcpComplete, markFrameReady, reduceMotion, storyFrames.length]);

  useEffect(() => {
    if (reduceMotion || storyFrames.length < 2) return;

    const timer = globalThis.setInterval(() => {
      if (isBackground && incomingIndex !== null) return;

      const nextIndex = (activeIndex + 1) % storyFrames.length;
      const nextFrame = storyFrames[nextIndex];
      if (!nextFrame) return;

      if (!frameReadyRef.current[nextFrame.key]) {
        preloadHeroFrame(nextFrame, () => markFrameReady(nextFrame.key));
        return;
      }

      if (isBackground) {
        setIncomingIndex(nextIndex);
        setActiveIndex(nextIndex);
        if (transitionTimerRef.current !== null) {
          globalThis.clearTimeout(transitionTimerRef.current);
        }
        transitionTimerRef.current = globalThis.setTimeout(() => {
          setDisplayedIndex(nextIndex);
          setIncomingIndex(null);
          transitionTimerRef.current = null;
        }, BG_CROSSFADE_MS);
      } else {
        setActiveIndex(nextIndex);
      }
    }, STORY_CYCLE_MS);

    return () => globalThis.clearInterval(timer);
  }, [reduceMotion, markFrameReady, activeIndex, incomingIndex, isBackground, storyFrames]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        globalThis.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const frames = reduceMotion ? storyFrames.slice(0, 1) : storyFrames;
  const isCrossfading = isBackground && incomingIndex !== null;

  return (
    <div
      className={cn(
        "caretip-hero-story-showcase-root",
        isBackground && "caretip-hero-story-showcase-root--background",
        className,
      )}
      data-hero-crossfading={isCrossfading ? "1" : undefined}
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
              const isLcpFrame = index === 0;

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
                  {frame.mobileAvif ? (
                    <source media="(max-width: 767px)" type="image/avif" srcSet={frame.mobileAvif} />
                  ) : null}
                  {frame.mobileWebp ? (
                    <source media="(max-width: 767px)" type="image/webp" srcSet={frame.mobileWebp} />
                  ) : null}
                  {frame.mobileSrc ? (
                    <source media="(max-width: 767px)" srcSet={frame.mobileSrc} />
                  ) : null}
                  {frame.avif ? <source type="image/avif" srcSet={frame.avif} /> : null}
                  {frame.webp ? <source type="image/webp" srcSet={frame.webp} /> : null}
                  <img
                    ref={isLcpFrame ? lcpImgRef : undefined}
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
                    loading={isLcpFrame ? "eager" : "lazy"}
                    decoding={isLcpFrame ? "sync" : "async"}
                    sizes={imageSizes}
                    onLoad={isLcpFrame ? handleLcpFrameLoad : () => markFrameReady(frame.key)}
                    {...(isLcpFrame
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
