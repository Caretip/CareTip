/**
 * CareTip mark for transactional emails.
 *
 * Remote `<img src>` must be a publicly fetchable HTTPS PNG. Gmail cannot load
 * localhost, and SPA hosts that return HTML 200 for unknown paths look like a
 * broken image. `caretip-email-mark.png` is local-only until deployed; production
 * currently serves HTML for that URL. Use the live `/brand/caretip-app-icon.png`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalCheckoutHostname } from "../config/frontendUrl.js";

/** Must match `<img src="cid:…">` if a caller still emits CID (should not in HTML). */
export const CARETIP_EMAIL_LOGO_CID = "caretip-logo";

const EMAIL_MARK_FILENAME = "caretip-email-mark.png";
const LIVE_PUBLIC_ICON_FILENAME = "caretip-app-icon.png";
const LEGACY_LOGO_FILENAME = "caretip-logo-primary.png";
const PUBLIC_BRAND_ORIGIN = "https://caretip.de";

const ALLOWED_LOGO_HOSTS = new Set(["caretip.de", "www.caretip.de"]);

function candidateIconPaths(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  const names = [EMAIL_MARK_FILENAME, LIVE_PUBLIC_ICON_FILENAME, LEGACY_LOGO_FILENAME];
  const dirs = [
    path.join(cwd, "assets", "email"),
    path.join(here, "..", "..", "assets", "email"),
    path.join(here, "..", "..", "..", "assets", "email"),
    path.join(cwd, "..", "public", "brand"),
    path.join(cwd, "public", "brand"),
  ];
  const out: string[] = [];
  for (const dir of dirs) {
    for (const name of names) out.push(path.join(dir, name));
  }
  return out;
}

export function resolveCareTipEmailLogoPath(): string | null {
  for (const p of candidateIconPaths()) {
    if (existsSync(p)) return p;
  }
  return null;
}

function isAllowedPublicPngUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return false;
    if (isLocalCheckoutHostname(u.hostname)) return false;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!ALLOWED_LOGO_HOSTS.has(u.hostname.toLowerCase()) && !ALLOWED_LOGO_HOSTS.has(host)) {
      return false;
    }
    if (u.username || u.password) return false;
    if (!/^\/brand\/[a-z0-9._-]+\.png$/i.test(u.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Hosted HTTPS PNG that email clients can fetch without cookies/JWT.
 * Never uses FRONTEND_URL (often localhost in local Resend sends).
 * Optional CARETIP_EMAIL_LOGO_URL must be https://caretip.de/brand/*.png.
 */
export function resolveCareTipEmailLogoRemoteUrl(): string {
  const override = process.env.CARETIP_EMAIL_LOGO_URL?.trim() ?? "";
  if (override && isAllowedPublicPngUrl(override)) return override;
  return `${PUBLIC_BRAND_ORIGIN}/brand/${LIVE_PUBLIC_ICON_FILENAME}`;
}

export type CareTipEmailLogoAttachment = {
  filename: string;
  content_id: string;
  content?: string;
  path?: string;
  content_type: string;
  content_disposition: "inline";
};

/**
 * Resend inline attachment — only used if HTML still contains cid:caretip-logo.
 */
export function getCareTipEmailLogoAttachment(): CareTipEmailLogoAttachment | null {
  const local = resolveCareTipEmailLogoPath();
  if (local) {
    return {
      filename: path.basename(local),
      content_id: CARETIP_EMAIL_LOGO_CID,
      content_type: "image/png",
      content_disposition: "inline",
      content: readFileSync(local).toString("base64"),
    };
  }
  return {
    filename: LIVE_PUBLIC_ICON_FILENAME,
    content_id: CARETIP_EMAIL_LOGO_CID,
    content_type: "image/png",
    content_disposition: "inline",
    path: resolveCareTipEmailLogoRemoteUrl(),
  };
}
