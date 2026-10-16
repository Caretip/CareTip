/**
 * Redaction rule for manager/admin Connect payout DTOs, aligned with `assertSafeDto` in
 * stripeConnectPayout.service.ts. The `po_` payout id and `destinationLast4` are intentional
 * DTO fields; connected account ids, full destinations, bank details and secrets are not.
 */
export function checkConnectPayoutDtoRedaction(dto: unknown): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!dto || typeof dto !== "object") return { ok: false, problems: ["dto missing"] };
  const raw = JSON.stringify(dto);
  const rec = dto as Record<string, unknown>;

  if (/"iban"|routing|account_number|bank_account_number|sk_live|sk_test|rk_live|rk_test|whsec_/i.test(raw)) {
    problems.push("bank detail or secret pattern in DTO");
  }
  if (/"destination":/.test(raw)) problems.push("full payout destination key in DTO");
  if (/acct_[A-Za-z0-9]/.test(raw)) problems.push("connected account id in DTO");
  if ("stripeAccountId" in rec) problems.push("stripeAccountId key in DTO");
  if ("stripePayoutId" in rec && !(typeof rec.stripePayoutId === "string" && /^po_[A-Za-z0-9_]+$/.test(rec.stripePayoutId))) {
    problems.push("stripePayoutId is not a po_ payout id");
  }
  if (rec.destinationLast4 != null && !(typeof rec.destinationLast4 === "string" && /^[0-9A-Za-z]{4}$/.test(rec.destinationLast4))) {
    problems.push("destinationLast4 is not a 4-character suffix");
  }
  return { ok: problems.length === 0, problems };
}
