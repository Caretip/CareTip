/**
 * In-layout marketing lazy-route hold — main column only; Navigation stays mounted in MarketingShellLayout.
 */
export function MarketingOutletFallback() {
  return (
    <div
      className="min-h-[min(50vh,420px)] w-full bg-background"
      data-testid="marketing-outlet-hold"
      aria-hidden
    />
  );
}
