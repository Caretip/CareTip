type RepeatTipDataV1 = {
  v: 1;
  tipSessionId: string;
  businessId: string;
  employeeId: string;
  employeeName?: string | null;
  lastAmount: number;
  timestamp: number;
  repeatTipCount?: number;
  lastEmployeeIds?: string[];
};

type PendingTipDataV1 = {
  v: 1;
  tipSessionId: string;
  sessionId: string;
  businessId: string;
  employeeId: string;
  employeeName?: string | null;
  amount: number;
  timestamp: number;
};

const KEY_TIP_SESSION_ID = "caretip_tipSessionId";
const KEY_REPEAT_TIP_DATA = "caretip_repeatTipData";
const KEY_PENDING_TIP_DATA = "caretip_pendingTipData";

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore (private mode / quota / disabled)
  }
}

function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function uuid(): string {
  try {
    // Modern browsers
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  // Fallback (not cryptographically strong, but fine for non-auth guest identity)
  return `rt_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}_${Math.random()
    .toString(16)
    .slice(2)}`;
}

export function getOrCreateTipSessionId(): string {
  const existing = safeLocalStorageGet(KEY_TIP_SESSION_ID);
  if (existing && existing.trim()) return existing.trim();
  const id = uuid();
  safeLocalStorageSet(KEY_TIP_SESSION_ID, id);
  return id;
}

export function getRepeatTipData(): RepeatTipDataV1 | null {
  const parsed = safeParseJson<RepeatTipDataV1>(safeLocalStorageGet(KEY_REPEAT_TIP_DATA));
  if (!parsed || parsed.v !== 1) return null;
  if (!parsed.businessId || !parsed.employeeId) return null;
  if (typeof parsed.lastAmount !== "number" || !(parsed.lastAmount > 0)) return null;
  if (typeof parsed.timestamp !== "number") return null;
  if (!parsed.tipSessionId) return null;
  return parsed;
}

export function getRepeatTipDataForBusiness(businessId: string): RepeatTipDataV1 | null {
  const d = getRepeatTipData();
  if (!d) return null;
  if (d.businessId !== businessId) return null;
  return d;
}

export function setPendingTipFromCheckout(payload: {
  sessionId: string;
  businessId: string;
  employeeId: string;
  employeeName?: string | null;
  amount: number;
}): void {
  const tipSessionId = getOrCreateTipSessionId();
  const pending: PendingTipDataV1 = {
    v: 1,
    tipSessionId,
    sessionId: payload.sessionId,
    businessId: payload.businessId,
    employeeId: payload.employeeId,
    employeeName: payload.employeeName ?? null,
    amount: payload.amount,
    timestamp: Date.now(),
  };
  safeLocalStorageSet(KEY_PENDING_TIP_DATA, JSON.stringify(pending));
}

export function promotePendingTipToRepeatTip(opts: {
  sessionId: string;
  verifiedBusinessId?: string | null;
  verifiedEmployee?: { id: string; name?: string | null } | null;
}): RepeatTipDataV1 | null {
  const pending = safeParseJson<PendingTipDataV1>(safeLocalStorageGet(KEY_PENDING_TIP_DATA));
  if (!pending || pending.v !== 1) return null;
  if (pending.sessionId !== opts.sessionId) return null;

  const tipSessionId = pending.tipSessionId || getOrCreateTipSessionId();
  const businessId = opts.verifiedBusinessId ?? pending.businessId;
  const employeeId = opts.verifiedEmployee?.id ?? pending.employeeId;
  const employeeName = opts.verifiedEmployee?.name ?? pending.employeeName ?? null;
  const lastAmount = pending.amount;

  const prev = getRepeatTipData();
  const prevCount = prev?.repeatTipCount ?? 0;
  const prevHistory = Array.isArray(prev?.lastEmployeeIds) ? prev!.lastEmployeeIds! : [];
  const nextHistory = [employeeId, ...prevHistory.filter((id) => id !== employeeId)].slice(0, 3);

  const next: RepeatTipDataV1 = {
    v: 1,
    tipSessionId,
    businessId,
    employeeId,
    employeeName,
    lastAmount,
    timestamp: Date.now(),
    repeatTipCount: prevCount + 1,
    lastEmployeeIds: nextHistory,
  };

  safeLocalStorageSet(KEY_REPEAT_TIP_DATA, JSON.stringify(next));
  safeLocalStorageRemove(KEY_PENDING_TIP_DATA);
  return next;
}

/**
 * Where a guest can try again after a checkout that did not complete: the amount screen for the same
 * team member, from the pending tip saved just before the Stripe redirect. Presentation only — the
 * payment status itself always comes from the server.
 */
export function guestTipRetryPathForSession(sessionId: string): string | null {
  const pending = safeParseJson<PendingTipDataV1>(safeLocalStorageGet(KEY_PENDING_TIP_DATA));
  if (!pending || pending.v !== 1 || pending.sessionId !== sessionId) return null;
  if (typeof pending.employeeId !== "string" || !pending.employeeId.trim()) return null;
  // A stale record (over a day old) should not steer a later visit.
  if (!Number.isFinite(pending.timestamp) || Date.now() - pending.timestamp > 24 * 60 * 60 * 1000) return null;
  return `/tip-amount?employeeId=${encodeURIComponent(pending.employeeId.trim())}`;
}

export function clearRepeatTipData(): void {
  safeLocalStorageRemove(KEY_REPEAT_TIP_DATA);
}

