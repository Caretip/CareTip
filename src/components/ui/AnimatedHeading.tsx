import { Fragment, memo, useMemo, useRef } from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  type Variants,
} from "framer-motion";

import { cn } from "@/lib/utils";

export type AnimatedHeadingProps = {
  text: string;
  duration?: number;
  /** Stagger between words (seconds). */
  stagger?: number;
  framerProps?: Variants;
  /** Applied to each word (inherits parent typography by default). */
  className?: string;
  /** Wrapper — keep inline so parent heading alignment/wrapping stay natural. */
  containerClassName?: string;
  /** Phrases to emphasize (brand accent words). */
  highlight?: string | string[];
  highlightClassName?: string;
  /** Play once when first entering the viewport (default true). */
  once?: boolean;
};

const DEFAULT_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

function collectHighlightRanges(
  text: string,
  phrases: string[],
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const raw of phrases) {
    const phrase = raw.trim();
    if (!phrase) continue;
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(phrase, from);
      if (index === -1) break;
      ranges.push({ start: index, end: index + phrase.length });
      from = index + phrase.length;
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function overlaps(
  start: number,
  end: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

type WordToken = {
  word: string;
  start: number;
  end: number;
};

function tokenizeWords(text: string): WordToken[] {
  const parts = text.split(" ");
  const tokens: WordToken[] = [];
  let cursor = 0;

  for (let i = 0; i < parts.length; i++) {
    const word = parts[i] ?? "";
    if (i > 0) cursor += 1; // account for the space separator
    const start = cursor;
    const end = start + word.length;
    tokens.push({ word, start, end });
    cursor = end;
  }

  return tokens;
}

/**
 * Production heading reveal — animates whole words with natural browser wrapping.
 * Never splits words into characters. Typography comes from parent / `className`.
 */
export const AnimatedHeading = memo(function AnimatedHeading({
  text,
  duration = 0.5,
  stagger = 0.05,
  framerProps = DEFAULT_VARIANTS,
  className,
  containerClassName,
  highlight,
  highlightClassName,
  once = true,
}: AnimatedHeadingProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once, amount: 0.35 });

  const highlightPhrases = useMemo(
    () =>
      (Array.isArray(highlight) ? highlight : highlight ? [highlight] : [])
        .map((w) => w.trim())
        .filter(Boolean),
    [highlight],
  );

  const ranges = useMemo(
    () => collectHighlightRanges(text, highlightPhrases),
    [text, highlightPhrases],
  );

  const tokens = useMemo(() => tokenizeWords(text), [text]);

  if (reduceMotion) {
    return (
      <span ref={ref} className={cn(containerClassName)}>
        {tokens.map((token, i) => (
          <Fragment key={`${i}-${token.word}`}>
            {i > 0 ? " " : null}
            <span
              className={cn(
                className,
                overlaps(token.start, token.end, ranges) && highlightClassName,
              )}
            >
              {token.word}
            </span>
          </Fragment>
        ))}
      </span>
    );
  }

  return (
    <span ref={ref} className={cn(containerClassName)} aria-label={text}>
      {tokens.map((token, i) => {
        // Empty token from consecutive spaces — keep the separator only.
        if (!token.word) {
          return i > 0 ? <Fragment key={`space-${i}`}>{" "}</Fragment> : null;
        }

        return (
          <Fragment key={`${i}-${token.word}`}>
            {i > 0 ? " " : null}
            <motion.span
              aria-hidden
              initial="hidden"
              animate={inView ? "visible" : "hidden"}
              variants={framerProps}
              transition={{
                duration,
                delay: inView ? i * stagger : 0,
                ease: "easeOut",
              }}
              className={cn(
                // inline-block + nowrap keeps each word atomic; spaces outside allow natural wraps.
                "inline-block whitespace-nowrap will-change-transform",
                className,
                overlaps(token.start, token.end, ranges) && highlightClassName,
              )}
            >
              {token.word}
            </motion.span>
          </Fragment>
        );
      })}
    </span>
  );
});

export default AnimatedHeading;
