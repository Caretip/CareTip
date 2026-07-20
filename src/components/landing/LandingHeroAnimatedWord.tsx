import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { cn } from "@/lib/utils";

const ROTATE_MS = 4200;
const EXIT_MS = 320;
const ENTER_MS = 420;
const SLOT_LINE_HEIGHT = "1em";

type LandingHeroAnimatedWordProps = {
  words: string[];
  className?: string;
};

type Phase = "idle" | "exiting" | "entering";

/**
 * Premium hero keyword reel — one visible word at a time.
 * Exit fully completes before the next word enters (no overlapping ghosts).
 */
export function LandingHeroAnimatedWord({ words, className }: LandingHeroAnimatedWordProps) {
  const reduceMotion = usePrefersReducedMotion();
  const safeWords = useMemo(() => words.filter(Boolean), [words]);
  const [targetIndex, setTargetIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const timersRef = useRef<number[]>([]);

  const clearTimers = () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  };

  useEffect(() => {
    setTargetIndex(0);
    setDisplayedIndex(0);
    setPhase("idle");
    clearTimers();
  }, [safeWords]);

  useEffect(() => {
    if (reduceMotion || safeWords.length <= 1) return;
    const id = window.setInterval(() => {
      setTargetIndex((i) => (i + 1) % safeWords.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion, safeWords.length]);

  useEffect(() => {
    if (reduceMotion || safeWords.length <= 1) return;
    if (targetIndex === displayedIndex) return;
    if (phase !== "idle") return;

    setPhase("exiting");
    clearTimers();

    const exitTimer = window.setTimeout(() => {
      setDisplayedIndex(targetIndex);
      setPhase("entering");

      const enterTimer = window.setTimeout(() => {
        setPhase("idle");
      }, ENTER_MS);
      timersRef.current.push(enterTimer);
    }, EXIT_MS);

    timersRef.current.push(exitTimer);

    return clearTimers;
  }, [targetIndex, displayedIndex, phase, reduceMotion, safeWords.length]);

  const activeWord = safeWords[displayedIndex];

  if (!safeWords.length) return null;

  if (reduceMotion || safeWords.length <= 1) {
    return (
      <span
        className={cn(
          "caretip-hero-animated-word caretip-hero-animated-word--static inline-block whitespace-nowrap",
          className,
        )}
        style={{ minHeight: SLOT_LINE_HEIGHT, lineHeight: SLOT_LINE_HEIGHT }}
      >
        {safeWords[0]}
      </span>
    );
  }

  const slidePhaseClass =
    phase === "exiting"
      ? "caretip-hero-animated-word__slide--exit"
      : phase === "entering"
        ? "caretip-hero-animated-word__slide--enter"
        : "caretip-hero-animated-word__slide--idle";

  return (
    <span
      className={cn(
        "caretip-hero-animated-word inline-grid align-top [grid-template-columns:minmax(0,max-content)]",
        className,
      )}
      style={{ minHeight: SLOT_LINE_HEIGHT }}
      aria-live="polite"
    >
      {/* Invisible measure layer — widest word reserves slot width */}
      {safeWords.map((word) => (
        <span
          key={`measure-${word}`}
          data-measure-word
          aria-hidden
          className="col-start-1 row-start-1 whitespace-nowrap opacity-0 pointer-events-none select-none font-inherit font-extrabold"
          style={{ height: SLOT_LINE_HEIGHT, lineHeight: SLOT_LINE_HEIGHT }}
        >
          {word}
        </span>
      ))}

      <span
        className="caretip-hero-animated-word__viewport relative col-start-1 row-start-1 block overflow-hidden align-top"
        style={{ height: SLOT_LINE_HEIGHT, minHeight: SLOT_LINE_HEIGHT }}
      >
        <span
          key={displayedIndex}
          data-reel-word
          className={cn(
            "caretip-hero-animated-word__slide absolute inset-x-0 top-0 flex items-center whitespace-nowrap",
            slidePhaseClass,
            className,
          )}
          style={{ height: SLOT_LINE_HEIGHT, lineHeight: SLOT_LINE_HEIGHT }}
        >
          {activeWord}
        </span>
      </span>
    </span>
  );
}
