/**
 * Mobile-only line break that still leaves a real word space on desktop.
 * A hidden `<br>` collapses adjacent HTML whitespace, so the gap lives in
 * a dedicated span shown from 768px up.
 */
export function HeadlineMobileBreak({
  "aria-hidden": ariaHidden = true,
}: {
  "aria-hidden"?: boolean;
}) {
  return (
    <span className="caretip-headline-mobile-break">
      <br className="caretip-br--mobile" aria-hidden={ariaHidden} />
      <span className="caretip-br--desktop-gap" aria-hidden>
        {"\u00a0"}
      </span>
    </span>
  );
}
