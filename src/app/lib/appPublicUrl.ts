/**
 * Public web app base URL for links and QR payloads (never the API host).
 *
 * **Source of truth (production):** set `BASE_URL=https://caretip.de` in the environment used when
 * running `vite build` (and optionally in dev `.env`). Vite injects the normalized origin as
 * `import.meta.env.VITE_CARETIP_APP_ORIGIN` — see `vite.config.ts` (`loadEnv` + `define`).
 *
 * Fallback order in the client: injected origin → `VITE_BASE_URL` → `NEXT_PUBLIC_APP_URL` →
 * `VITE_APP_URL` → `window.location.origin` (so local/dev QR still work without env).
 *
 * QR codes must encode **absolute** https URLs so phone cameras open the correct host (relative
 * paths in a QR are not portable when scanned).
 */

/** Strips common copy-paste mistakes (e.g. `VITE_APP_URL=https://…` stored in the wrong field). */
function sanitizePublicSiteOrigin(raw: string): string {
  let s = raw
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\uFF1D/g, "=")
    .replace(/\/+$/, "");
  if (!s) return "";
  const keyPrefixes = [/^VITE_APP_URL=/i, /^NEXT_PUBLIC_APP_URL=/i];
  for (let i = 0; i < 8; i++) {
    const before = s;
    for (const re of keyPrefixes) {
      if (re.test(s)) s = s.replace(re, "").trim().replace(/\/+$/, "");
    }
    if (s === before) break;
  }
  const bogusOnly = /^(VITE_APP_URL|NEXT_PUBLIC_APP_URL)$/i.test(s);
  if (bogusOnly) return "";
  s = s
    .replace(/^VITE_APP_URL(?=https?:\/\/)/i, "")
    .replace(/^NEXT_PUBLIC_APP_URL(?=https?:\/\/)/i, "")
    .replace(/^VITE_APP_URL\s+(?=https?:\/\/)/i, "")
    .replace(/^NEXT_PUBLIC_APP_URL\s+(?=https?:\/\/)/i, "")
    .trim()
    .replace(/\/+$/, "");
  const m = s.match(/https?:\/\/[^\s"'`]+/i);
  if (m && m.index !== undefined && m.index > 0) {
    s = m[0].trim().replace(/\/+$/, "");
  }
  return s;
}

/**
 * Turns a dashboard/env value into `https://host` only (no path). Handles pasted `.env` lines,
 * fullwidth `＝`, and values where the first `https://` is not at position 0.
 */
function envRawToPublicOrigin(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const normalizedInput = raw.replace(/^\uFEFF/, "").replace(/\uFF1D/g, "=");
  let s = sanitizePublicSiteOrigin(normalizedInput);
  if (!/^https?:\/\//i.test(s)) {
    const m = normalizedInput.match(/https?:\/\/[^\s"'`]+/i);
    if (m) s = m[0].trim().replace(/\/+$/, "");
  }
  if (!/^https?:\/\//i.test(s)) return "";
  try {
    return new URL(s).origin.replace(/\/+$/, "");
  } catch {
    const hostOnly = s.match(/^https?:\/\/[^/]+/i);
    return hostOnly ? hostOnly[0].replace(/\/+$/, "") : "";
  }
}

function readEnvBase(): string {
  const candidates = [
    import.meta.env.VITE_CARETIP_APP_ORIGIN,
    import.meta.env.VITE_BASE_URL,
    import.meta.env.NEXT_PUBLIC_BASE_URL,
    import.meta.env.NEXT_PUBLIC_APP_URL,
    import.meta.env.VITE_APP_URL,
  ];
  for (const raw of candidates) {
    const origin = envRawToPublicOrigin(typeof raw === "string" ? raw : "");
    if (origin) return origin;
  }
  return "";
}

/** Absolute origin for customer-facing URLs and QR codes. */
export function getAppPublicBaseUrl(): string {
  const fromEnv = readEnvBase();
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "";
}

function joinPath(path: string): string {
  const base = getAppPublicBaseUrl().replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  let out = `${base}${p}`;
  if (typeof window !== "undefined" && !/^https?:\/\//i.test(out)) {
    out = `${window.location.origin.replace(/\/+$/, "")}${p}`;
  }
  return out;
}

function slugPathSegment(raw: string): string {
  return encodeURIComponent(raw.trim().toLowerCase());
}

/** Canonical business storefront / team directory: `/{businessSlug}` */
export function publicBusinessTipUrl(businessSlug: string): string {
  return joinPath(`/${slugPathSegment(businessSlug)}`);
}

/**
 * Canonical employee tip entry: `/{businessSlug}/{employeeSlug}` (matches Postgres slugs).
 */
export function publicEmployeeTipUrl(businessSlug: string, employeeSlug: string): string {
  return joinPath(`/${slugPathSegment(businessSlug)}/${slugPathSegment(employeeSlug)}`);
}

/** Legacy deep link by employee row id (still supported; redirects client-side to slug URL when possible). */
export function qrEmployeeLegacyUrl(employeeId: string): string {
  return joinPath(`/qr/employee/${encodeURIComponent(employeeId)}`);
}

/**
 * Single URL resolver for employee QR cards (preview / PNG / PDF).
 * Prefer canonical slug pair; fall back to legacy id URL so branding never depends on slug presence.
 */
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

/** @deprecated Alias of {@link qrEmployeeLegacyUrl}; use {@link publicEmployeeTipUrl} for new QR codes. */
export function qrEmployeeUrl(employeeId: string): string {
  return qrEmployeeLegacyUrl(employeeId);
}

/** @deprecated Prefer {@link publicBusinessTipUrl}. */
export function businessDirectoryUrl(businessSlug: string): string {
  return publicBusinessTipUrl(businessSlug);
}

/** /qr/location/:locationId */
export function qrLocationUrl(locationId: string): string {
  return joinPath(`/qr/location/${encodeURIComponent(locationId)}`);
}

/** /qr/table/:tableId */
export function qrTableUrl(tableId: string): string {
  return joinPath(`/qr/table/${encodeURIComponent(tableId)}`);
}

/** /qr/business/:businessId (redirects to qr-landing) */
export function qrBusinessUrl(businessId: string): string {
  return joinPath(`/qr/business/${encodeURIComponent(businessId)}`);
}

/** /qr-landing/:businessId — storefront / team picker when no slug */
export function qrLandingUrl(businessId: string): string {
  return joinPath(`/qr-landing/${encodeURIComponent(businessId)}`);
}

/** Legacy guest link by table slug (tipping context) */
export function tableBySlugUrl(qrSlug: string): string {
  return joinPath(`/table/${encodeURIComponent(qrSlug)}`);
}
