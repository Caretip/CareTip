import { lazy, Suspense } from "react";

import { cn } from "@/lib/utils";
import type { GradualSpacingProps } from "./gradual-spacing";

const GradualSpacing = lazy(() =>
  import("./gradual-spacing").then((m) => ({ default: m.GradualSpacing })),
);

export type GradualSpacingLazyProps = GradualSpacingProps;

/** Static fallback matching final typography — avoids CLS while the motion chunk loads. */
function GradualSpacingFallback({
  text,
  className,
  containerClassName,
  highlight,
  highlightClassName,
}: GradualSpacingLazyProps) {
  const words = (Array.isArray(highlight) ? highlight : highlight ? [highlight] : [])
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return (
      <span className={cn("inline", containerClassName)}>
        <span className={className}>{text}</span>
      </span>
    );
  }

  const parts: Array<{ value: string; hl: boolean }> = [];
  let cursor = 0;
  const matches = words
    .flatMap((word) => {
      const out: Array<{ index: number; word: string }> = [];
      let from = 0;
      while (from < text.length) {
        const index = text.indexOf(word, from);
        if (index === -1) break;
        out.push({ index, word });
        from = index + word.length;
      }
      return out;
    })
    .sort((a, b) => a.index - b.index);

  for (const { index, word } of matches) {
    if (index < cursor) continue;
    if (index > cursor) parts.push({ value: text.slice(cursor, index), hl: false });
    parts.push({ value: word, hl: true });
    cursor = index + word.length;
  }
  if (cursor < text.length) parts.push({ value: text.slice(cursor), hl: false });

  return (
    <span className={cn("inline", containerClassName)}>
      {parts.map((part, i) => (
        <span key={`${i}-${part.value}`} className={cn(className, part.hl && highlightClassName)}>
          {part.value}
        </span>
      ))}
    </span>
  );
}

/** Lazy-loads framer-motion GradualSpacing; shows static text until ready. */
export function GradualSpacingLazy(props: GradualSpacingLazyProps) {
  return (
    <Suspense fallback={<GradualSpacingFallback {...props} />}>
      <GradualSpacing {...props} />
    </Suspense>
  );
}
