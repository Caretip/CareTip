export function physicalQrPublicOrigin(): string {
  const raw = (
    process.env.PUBLIC_APP_ORIGIN ??
    process.env.APP_PUBLIC_URL ??
    process.env.FRONTEND_URL ??
    "https://caretip.de"
  ).trim();
  return raw.replace(/\/+$/, "") || "https://caretip.de";
}

function slugSeg(raw: string): string {
  return encodeURIComponent(raw.trim().toLowerCase());
}

export function canonicalStorefrontUrl(businessSlug: string): string {
  return `${physicalQrPublicOrigin()}/${slugSeg(businessSlug)}`;
}

export function canonicalEmployeeUrl(businessSlug: string, employeeSlug: string): string {
  return `${physicalQrPublicOrigin()}/${slugSeg(businessSlug)}/${slugSeg(employeeSlug)}`;
}

export function canonicalEmployeeLegacyUrl(employeeId: string): string {
  return `${physicalQrPublicOrigin()}/qr/employee/${encodeURIComponent(employeeId)}`;
}

export function canonicalLocationUrl(locationId: string): string {
  return `${physicalQrPublicOrigin()}/qr/location/${encodeURIComponent(locationId)}`;
}

export function canonicalTableUrl(tableId: string): string {
  return `${physicalQrPublicOrigin()}/qr/table/${encodeURIComponent(tableId)}`;
}
