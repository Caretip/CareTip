import { Fragment, lazy, Suspense } from "react";

import { cn } from "@/lib/utils";
import type { AnimatedHeadingProps } from "./AnimatedHeading";

const AnimatedHeading = lazy(() =>
  import("./AnimatedHeading").then((m) => ({ default: m.AnimatedHeading })),
);

export type AnimatedHeadingLazyProps = AnimatedHeadingProps;

function AnimatedHeadingFallback({
  text,
  className,
  containerClassName,
  highlight,
  highlightClassName,
}: AnimatedHeadingLazyProps) {
  const phrases = (Array.isArray(highlight) ? highlight : highlight ? [highlight] : [])
    .map((w) => w.trim())
    .filter(Boolean);

  const words = text.split(" ");

  if (phrases.length === 0) {
    return (
      <span className={cn(containerClassName)}>
        {words.map((word, i) => (
          <Fragment key={`${i}-${word}`}>
            {i > 0 ? " " : null}
            <span className={cn("inline-block whitespace-nowrap", className)}>{word}</span>
          </Fragment>
        ))}
      </span>
    );
  }

  // Mirror highlight detection for CLS-stable static paint.
  const ranges: Array<{ start: number; end: number }> = [];
  for (const phrase of phrases) {
    let from = 0;
    while (from < text.length) {
      const index = text.indexOf(phrase, from);
      if (index === -1) break;
      ranges.push({ start: index, end: index + phrase.length });
      from = index + phrase.length;
    }
  }

  let cursor = 0;
  return (
    <span className={cn(containerClassName)}>
      {words.map((word, i) => {
        if (i > 0) cursor += 1;
        const start = cursor;
        const end = start + word.length;
        cursor = end;
        const hl = ranges.some((r) => start < r.end && end > r.start);
        return (
          <Fragment key={`${i}-${word}`}>
            {i > 0 ? " " : null}
            <span className={cn("inline-block whitespace-nowrap", className, hl && highlightClassName)}>
              {word}
            </span>
          </Fragment>
        );
      })}
    </span>
  );
}

/** Lazy-loads motion; static word layout fallback prevents CLS. */
export function AnimatedHeadingLazy(props: AnimatedHeadingLazyProps) {
  return (
    <Suspense fallback={<AnimatedHeadingFallback {...props} />}>
      <AnimatedHeading {...props} />
    </Suspense>
  );
}
