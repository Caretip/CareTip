/**
 * Dev-only Physical QR checkout timings. Never logs secrets, tokens, or PII.
 */
export function physicalQrPerfNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function logPhysicalQrPerf(
  stage: string,
  durationMs: number,
  extra?: { zeroCost?: boolean },
): void {
  if (!import.meta.env.DEV) return;
  const zero =
    extra?.zeroCost === true ? " zeroCost=true" : extra?.zeroCost === false ? " zeroCost=false" : "";
  console.info(`[PhysicalQR][PERF]\nstage=${stage}\ndurationMs=${Math.round(durationMs)}${zero}`);
}
