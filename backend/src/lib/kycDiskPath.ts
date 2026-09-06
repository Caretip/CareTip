import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export type ResolveKycDiskPathOptions = {
  /** Override process cwd (isolated tests). Never a user-controlled value. */
  cwd?: string;
};

export type ResolvedKycDiskPath = { ok: true; absolutePath: string } | { ok: false };

function reject(): { ok: false } {
  return { ok: false };
}

function sanitizeBusinessId(businessId: string): string | null {
  const raw = String(businessId ?? "").trim();
  if (!raw) return null;
  const safe = raw.replace(/[^a-zA-Z0-9-_]/g, "");
  if (!safe || safe !== raw) return null;
  return safe;
}

/**
 * Decode at most once. Residual `%` after decode is rejected (blocks double-encoding).
 */
export function decodeKycRelativePath(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s || s.includes("\0")) return null;
  if (!s.includes("%")) return s;
  try {
    const decoded = decodeURIComponent(s);
    if (decoded.includes("%") || decoded.includes("\0")) return null;
    return decoded;
  } catch {
    return null;
  }
}

function looksAbsoluteOrRemote(p: string): boolean {
  if (!p) return true;
  if (path.isAbsolute(p)) return true;
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith("//") || p.startsWith("\\\\")) return true;
  return false;
}

/**
 * True iff `candidateAbs` is a path strictly inside `rootAbs` (not the root itself).
 * Rejects `..` relatives and Windows drive-absolute leftovers from `path.relative`.
 */
export function isStrictlyInsideDirectory(rootAbs: string, candidateAbs: string): boolean {
  const root = path.resolve(rootAbs);
  const candidate = path.resolve(candidateAbs);
  if (root === candidate) return false;
  const rel = path.relative(root, candidate);
  if (!rel || rel === ".") return false;
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  const relPosix = rel.replace(/\\/g, "/");
  if (relPosix.split("/").includes("..")) return false;
  return true;
}

/**
 * Canonical jail: candidate must resolve inside `{cwd}/uploads/kyc/{businessId}/`.
 * Does not trust string prefixes. Follows realpath when the file exists (symlink escape).
 */
export function resolveKycDiskPathForBusiness(
  businessId: string,
  relativePath: string,
  opts?: ResolveKycDiskPathOptions,
): ResolvedKycDiskPath {
  const safeBiz = sanitizeBusinessId(businessId);
  if (!safeBiz) return reject();

  const decoded = decodeKycRelativePath(relativePath);
  if (!decoded) return reject();

  const normalized = decoded.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (looksAbsoluteOrRemote(normalized) || looksAbsoluteOrRemote(decoded)) return reject();

  const cwd = opts?.cwd ?? process.cwd();
  const cwdAbs = path.resolve(cwd);
  const businessRootAbs = path.resolve(cwdAbs, "uploads", "kyc", safeBiz);
  const candidateAbs = path.resolve(cwdAbs, normalized);

  if (!isStrictlyInsideDirectory(businessRootAbs, candidateAbs)) return reject();

  try {
    if (existsSync(candidateAbs)) {
      const st = lstatSync(candidateAbs);
      if (st.isDirectory()) return reject();
      const candidateReal = realpathSync(candidateAbs);
      const rootReal = existsSync(businessRootAbs) ? realpathSync(businessRootAbs) : businessRootAbs;
      if (!isStrictlyInsideDirectory(rootReal, candidateReal)) return reject();
      return { ok: true, absolutePath: candidateReal };
    }
    return { ok: true, absolutePath: candidateAbs };
  } catch {
    return reject();
  }
}

export function isAllowedKycDiskPathForBusiness(
  businessId: string,
  relativePath: string,
  opts?: ResolveKycDiskPathOptions,
): boolean {
  return resolveKycDiskPathForBusiness(businessId, relativePath, opts).ok;
}
