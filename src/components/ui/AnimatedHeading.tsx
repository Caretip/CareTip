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
  type: "word";
  word: string;
  start: number;
  end: number;
};

type BreakToken = {
  type: "br";
};

type HeadingToken = WordToken | BreakToken;

/**
 * Tokenize heading text. Newlines become mobile-only line breaks
 * (`<br class="caretip-br--mobile" />`) so desktop can stay single-flow.
 */
function tokenizeHeading(text: string): { tokens: HeadingToken[]; flatText: string } {
  const lines = text.split("\n");
  const tokens: HeadingToken[] = [];
  let flatCursor = 0;

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      tokens.push({ type: "br" });
      flatCursor += 1; // space separator in flat text
    }

    const parts = line.split(" ");
    for (let i = 0; i < parts.length; i++) {
      const word = parts[i] ?? "";
      if (i > 0) flatCursor += 1;
      const start = flatCursor;
      const end = start + word.length;
      tokens.push({ type: "word", word, start, end });
      flatCursor = end;
    }
  });

  return { tokens, flatText: text.replace(/\n+/g, " ") };
}

/**
 * Production heading reveal — animates whole words with natural browser wrapping.
 * Never splits words into characters. Typography comes from parent / `className`.
 * `\n` in `text` inserts a mobile-only soft break (desktop keeps a space).
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

  const { tokens, flatText } = useMemo(() => tokenizeHeading(text), [text]);

  const ranges = useMemo(
    () => collectHighlightRanges(flatText, highlightPhrases),
    [flatText, highlightPhrases],
  );

  let wordIndex = 0;

  if (reduceMotion) {
    return (
      <span ref={ref} className={cn(containerClassName)}>
        {tokens.map((token, i) => {
          if (token.type === "br") {
            return (
              <Fragment key={`br-${i}`}>
                <br className="caretip-br--mobile" />{" "}
              </Fragment>
            );
          }
          const prev = tokens[i - 1];
          const leadSpace = i > 0 && prev?.type === "word" ? " " : null;
          return (
            <Fragment key={`${i}-${token.word}`}>
              {leadSpace}
              <span
                className={cn(
                  className,
                  overlaps(token.start, token.end, ranges) && highlightClassName,
                )}
              >
                {token.word}
              </span>
            </Fragment>
          );
        })}
      </span>
    );
  }

  return (
    <span ref={ref} className={cn(containerClassName)} aria-label={flatText}>
      {tokens.map((token, i) => {
        if (token.type === "br") {
          return (
            <Fragment key={`br-${i}`}>
              <br className="caretip-br--mobile" aria-hidden />{" "}
            </Fragment>
          );
        }

        if (!token.word) {
          const prev = tokens[i - 1];
          return prev?.type === "word" ? (
            <Fragment key={`space-${i}`}>{" "}</Fragment>
          ) : null;
        }

        const delayIndex = wordIndex++;
        const prev = tokens[i - 1];
        const leadSpace = i > 0 && prev?.type === "word" ? " " : null;

        return (
          <Fragment key={`${i}-${token.word}`}>
            {leadSpace}
            <motion.span
              aria-hidden
              initial="hidden"
              animate={inView ? "visible" : "hidden"}
              variants={framerProps}
              transition={{
                duration,
                delay: inView ? delayIndex * stagger : 0,
                ease: "easeOut",
              }}
              className={cn(
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
