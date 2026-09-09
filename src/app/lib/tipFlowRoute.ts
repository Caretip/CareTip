/** Query params so /payment bookmarks can recover tip-amount context. */
export function paymentPathFromTipAmount(opts: {
  employeeId: string;
  returnSlug?: string | null;
  returnBusinessSlug?: string | null;
  returnEmployeeSlug?: string | null;
}): string {
  const qs = new URLSearchParams({ employeeId: opts.employeeId });
  if (opts.returnBusinessSlug && opts.returnEmployeeSlug) {
    qs.set("returnBusinessSlug", opts.returnBusinessSlug);
    qs.set("returnEmployeeSlug", opts.returnEmployeeSlug);
  } else if (opts.returnSlug) {
    qs.set("returnSlug", opts.returnSlug);
  }
  return `/tip-amount?${qs.toString()}`;
}
