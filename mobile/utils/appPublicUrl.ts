import { config } from "@/constants/config";

function getAppPublicBaseUrl(): string {
  if (config.appUrl) return config.appUrl.replace(/\/+$/, "");
  return "https://caretip.de";
}

function joinPath(path: string): string {
  const base = getAppPublicBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

function slugPathSegment(raw: string): string {
  return encodeURIComponent(raw.trim().toLowerCase());
}

export function publicBusinessTipUrl(businessSlug: string): string {
  return joinPath(`/${slugPathSegment(businessSlug)}`);
}

export function publicEmployeeTipUrl(businessSlug: string, employeeSlug: string): string {
  return joinPath(`/${slugPathSegment(businessSlug)}/${slugPathSegment(employeeSlug)}`);
}

export function qrEmployeeLegacyUrl(employeeId: string): string {
  return joinPath(`/qr/employee/${encodeURIComponent(employeeId)}`);
}

export function resolveEmployeeQrUrl(opts: {
  employeeId: string;
  businessSlug?: string | null;
  employeeSlug?: string | null;
}): string {
  const employeeId = String(opts.employeeId ?? "").trim();
  if (!employeeId) return "";
  const businessSlug = opts.businessSlug?.trim() || "";
  const employeeSlug = opts.employeeSlug?.trim() || "";
  if (businessSlug && employeeSlug) {
    return publicEmployeeTipUrl(businessSlug, employeeSlug);
  }
  return qrEmployeeLegacyUrl(employeeId);
}

export function qrLocationUrl(locationId: string): string {
  return joinPath(`/qr/location/${encodeURIComponent(locationId)}`);
}

export function qrTableUrl(tableId: string): string {
  return joinPath(`/qr/table/${encodeURIComponent(tableId)}`);
}

export function qrTableSlugUrl(qrSlug: string): string {
  return joinPath(`/table/${encodeURIComponent(qrSlug)}`);
}
