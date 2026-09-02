/** Tables page surface + create-button rules — quota vs `tableQr` capability. */

export type TablesPageMainSurface =
  | "capability-lock"
  | "loading"
  | "need-location"
  | "empty"
  | "list";

export function isAtTableCap(input: {
  ready: boolean;
  tableQrEnabled: boolean;
  maxTables: number | null | undefined;
  tableCount: number;
}): boolean {
  return (
    input.ready &&
    input.tableQrEnabled &&
    input.maxTables != null &&
    input.tableCount >= input.maxTables
  );
}

export function isTablesCreateDisabled(input: {
  isBusiness: boolean;
  ready: boolean;
  tableQrEnabled: boolean;
  atTableCap: boolean;
}): boolean {
  return !input.isBusiness || (input.ready && (!input.tableQrEnabled || input.atTableCap));
}

/** Quota banner only when table QR is entitled and the numerical table limit is reached. */
export function shouldShowTableQuotaNotice(input: {
  tableQrEnabled: boolean;
  atTableCap: boolean;
}): boolean {
  return input.tableQrEnabled && input.atTableCap;
}

/**
 * Main body surface. Table cap must never be a branch here — the list/empty
 * states still render when `atTableCap` is true.
 */
export function resolveTablesPageMainSurface(input: {
  ready: boolean;
  tableQrEnabled: boolean;
  showInitialSkeleton: boolean;
  locationCount: number;
  tableCount: number;
}): TablesPageMainSurface {
  if (input.ready && !input.tableQrEnabled) return "capability-lock";
  if (input.showInitialSkeleton) return "loading";
  if (input.locationCount === 0) return "need-location";
  if (input.tableCount === 0) return "empty";
  return "list";
}
