/**
 * CareTip logo/icon for transactional emails.
 * Prefer the orange app icon (works on a white canvas). The old wordmark PNG is black-backed
 * and disappears or looks like a bar in Gmail.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Must match `<img src="cid:…">` in emailBrandMark. */
export const CARETIP_EMAIL_LOGO_CID = "caretip-logo";

const ICON_FILENAME = "caretip-app-icon.png";
const LEGACY_LOGO_FILENAME = "caretip-logo-primary.png";

function candidateIconPaths(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  const names = [ICON_FILENAME, LEGACY_LOGO_FILENAME];
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

/** Hosted HTTPS icon — Gmail often hides CID-only images. */
export function resolveCareTipEmailLogoRemoteUrl(): string | null {
  const origin = (
    process.env.FRONTEND_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VITE_APP_URL ||
    process.env.BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (origin) return `${origin}/brand/${ICON_FILENAME}`;
  if (process.env.NODE_ENV === "production") {
    return `https://caretip.de/brand/${ICON_FILENAME}`;
  }
  return null;
}

export type CareTipEmailLogoAttachment = {
  filename: string;
  content_id: string;
  content?: string;
  path?: string;
  content_type: string;
};

/**
 * Resend inline attachment for the brand icon. Prefer local base64; else remote path.
 */
export function getCareTipEmailLogoAttachment(): CareTipEmailLogoAttachment | null {
  const local = resolveCareTipEmailLogoPath();
  if (local) {
    return {
      filename: ICON_FILENAME,
      content_id: CARETIP_EMAIL_LOGO_CID,
      content_type: "image/png",
      content: readFileSync(local).toString("base64"),
    };
  }
  const remote = resolveCareTipEmailLogoRemoteUrl();
  if (remote) {
    return {
      filename: ICON_FILENAME,
      content_id: CARETIP_EMAIL_LOGO_CID,
      content_type: "image/png",
      path: remote,
    };
  }
  return null;
}
