/**
 * Resolve canonical public employee tip URL (matches web/mobile appPublicUrl).
 */
export function resolveEmployeePublicTipUrl(input: {
  employeeId: string;
  employeeSlug?: string | null;
  businessSlug?: string | null;
}): string {
  const base = (process.env.PUBLIC_APP_ORIGIN ?? process.env.APP_PUBLIC_URL ?? "https://caretip.de")
    .replace(/\/+$/, "");
  const bs = input.businessSlug?.trim();
  const es = input.employeeSlug?.trim();
  if (bs && es) {
    return `${base}/${encodeURIComponent(bs)}/${encodeURIComponent(es)}`;
  }
  return `${base}/qr/employee/${encodeURIComponent(input.employeeId)}`;
}
