import { memo, useMemo, useRef, type CSSProperties } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from "framer-motion";

import { cn } from "@/lib/utils";

export type GradualSpacingProps = {
  text: string;
  duration?: number;
  delayMultiple?: number;
  framerProps?: Variants;
  /** Applied to each character glyph (typography lives here). */
  className?: string;
  /** Wrapper layout — defaults to inline flow so parent alignment is preserved. */
  containerClassName?: string;
  /**
   * Optional phrases to emphasize with `highlightClassName`
   * (e.g. brand accent words from landing copy).
   */
  highlight?: string | string[];
  highlightClassName?: string;
  /** Play once when first entering the viewport (default true). */
  once?: boolean;
};

const DEFAULT_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
};

function collectHighlightRanges(text: string, words: string[]): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const raw of words) {
    const word = raw.trim();
    if (!word) continue;
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(word, from);
      if (index === -1) break;
      ranges.push({ start: index, end: index + word.length });
      from = index + word.length;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function isHighlighted(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((r) => index >= r.start && index < r.end);
}

/**
 * Premium character reveal for major landing headlines.
 * Typography comes exclusively from `className` / parent styles — no hardcoded sizes.
 */
export const GradualSpacing = memo(function GradualSpacing({
  text,
  duration = 0.55,
  delayMultiple = 0.035,
  framerProps = DEFAULT_VARIANTS,
  className,
  containerClassName,
  highlight,
  highlightClassName,
  once = true,
}: GradualSpacingProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once, amount: 0.35 });

  const highlightWords = useMemo(
    () =>
      (Array.isArray(highlight) ? highlight : highlight ? [highlight] : [])
        .map((w) => w.trim())
        .filter(Boolean),
    [highlight],
  );

  const ranges = useMemo(
    () => collectHighlightRanges(text, highlightWords),
    [text, highlightWords],
  );

  const chars = useMemo(() => Array.from(text), [text]);

  if (reduceMotion) {
    return (
      <span ref={ref} className={cn("inline", containerClassName)}>
        {highlightWords.length === 0 ? (
          <span className={className}>{text}</span>
        ) : (
          chars.map((char, i) => (
            <span
              key={`${i}-${char}`}
              className={cn(className, isHighlighted(i, ranges) && highlightClassName)}
            >
              {char === " " ? "\u00A0" : char}
            </span>
          ))
        )}
      </span>
    );
  }

  return (
    <span
      ref={ref}
      className={cn(
        "inline-flex max-w-full flex-wrap tracking-normal",
        inView && !reduceMotion && "transition-[letter-spacing] duration-500 ease-out",
        containerClassName,
      )}
      style={
        reduceMotion || inView
          ? undefined
          : ({ letterSpacing: "0.02em" } as CSSProperties)
      }
      aria-label={text}
    >
      <AnimatePresence>
        {chars.map((char, i) => (
          <motion.span
            key={`${i}-${char}`}
            aria-hidden
            initial="hidden"
            animate={inView ? "visible" : "hidden"}
            exit="hidden"
            variants={framerProps}
            transition={{
              duration,
              delay: inView ? i * delayMultiple : 0,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={cn(
              "inline-block drop-shadow-sm will-change-transform",
              className,
              isHighlighted(i, ranges) && highlightClassName,
            )}
          >
            {char === " " ? "\u00A0" : char}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
});

export default GradualSpacing;
