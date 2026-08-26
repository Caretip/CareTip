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

  const flatText = text.replace(/\n+/g, " ");
  const lines = text.split("\n");

  const ranges: Array<{ start: number; end: number }> = [];
  for (const phrase of phrases) {
    let from = 0;
    while (from < flatText.length) {
      const index = flatText.indexOf(phrase, from);
      if (index === -1) break;
      ranges.push({ start: index, end: index + phrase.length });
      from = index + phrase.length;
    }
  }

  let cursor = 0;
  return (
    <span className={cn(containerClassName)} aria-label={flatText}>
      {lines.map((line, lineIndex) => {
        if (lineIndex > 0) cursor += 1;
        const words = line.split(" ");
        return (
          <Fragment key={`line-${lineIndex}`}>
            {lineIndex > 0 ? (
              <>
                <br className="caretip-br--mobile" aria-hidden />{" "}
              </>
            ) : null}
            {words.map((word, i) => {
              if (i > 0) cursor += 1;
              const start = cursor;
              const end = start + word.length;
              cursor = end;
              const hl = ranges.some((r) => start < r.end && end > r.start);
              return (
                <Fragment key={`${lineIndex}-${i}-${word}`}>
                  {i > 0 ? " " : null}
                  <span
                    className={cn(
                      "inline-block whitespace-nowrap",
                      className,
                      hl && highlightClassName,
                    )}
                  >
                    {word}
                  </span>
                </Fragment>
              );
            })}
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
