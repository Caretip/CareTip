import { parseSupabasePublicStorageUrl } from "../lib/supabaseStorageClient.js";

export const KYC_OBJECT_REF_PREFIX = "kyc-object:";
export const KYC_DISK_REF_PREFIX = "kyc-disk:";

export type ParsedKycStorageRef =
  | { kind: "kyc-object"; bucket: string; objectPath: string; businessId: string }
  | { kind: "kyc-disk"; relativePath: string; businessId: string }
  | { kind: "legacy-public-url"; url: string }
  | { kind: "legacy-disk-url"; url: string };

export function buildKycObjectStorageRef(bucket: string, objectPath: string): string {
  return `${KYC_OBJECT_REF_PREFIX}${bucket}/${objectPath.replace(/^\/+/, "")}`;
}

export function buildKycDiskStorageRef(relativePath: string): string {
  return `${KYC_DISK_REF_PREFIX}${relativePath.replace(/^\/+/, "")}`;
}

export function extractBusinessIdFromKycObjectPath(objectPath: string): string | null {
  const m = objectPath.match(/^verification\/([^/]+)\//);
  return m?.[1] ?? null;
}

export function extractBusinessIdFromKycDiskPath(relativePath: string): string | null {
  const m = relativePath.match(/^uploads\/kyc\/([^/]+)\//);
  return m?.[1] ?? null;
}

/** Strict allowlist for KYC object keys: verification/{businessId}/... */
export function isAllowedKycObjectPathForBusiness(businessId: string, objectPath: string): boolean {
  const key = objectPath.replace(/^\/+/, "").replace(/\/+/g, "/");
  const safeBiz = businessId.replace(/[^a-zA-Z0-9-_]/g, "");
  if (!safeBiz || key.includes("..") || key.startsWith("exports/") || key.startsWith("dsar/")) {
    return false;
  }
  return key.startsWith(`verification/${safeBiz}/`) && key.length > `verification/${safeBiz}/`.length;
}

/** Strict allowlist for on-disk KYC: uploads/kyc/{businessId}/... */
export function isAllowedKycDiskPathForBusiness(businessId: string, relativePath: string): boolean {
  const rel = relativePath.replace(/^\/+/, "").replace(/\/+/g, "/");
  const safeBiz = businessId.replace(/[^a-zA-Z0-9-_]/g, "");
  if (!safeBiz || rel.includes("..")) return false;
  return rel.startsWith(`uploads/kyc/${safeBiz}/`) && rel.length > `uploads/kyc/${safeBiz}/`.length;
}

export function parseKycStorageReference(raw: string): ParsedKycStorageRef | null {
  const s = raw.trim();
  if (!s) return null;

  if (s.startsWith(KYC_OBJECT_REF_PREFIX)) {
    const rest = s.slice(KYC_OBJECT_REF_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    const bucket = rest.slice(0, slash);
    const objectPath = rest.slice(slash + 1);
    const businessId = extractBusinessIdFromKycObjectPath(objectPath);
    if (!bucket || !objectPath || !businessId) return null;
    return { kind: "kyc-object", bucket, objectPath, businessId };
  }

  if (s.startsWith(KYC_DISK_REF_PREFIX)) {
    const relativePath = s.slice(KYC_DISK_REF_PREFIX.length);
    const businessId = extractBusinessIdFromKycDiskPath(relativePath);
    if (!relativePath || !businessId) return null;
    return { kind: "kyc-disk", relativePath, businessId };
  }

  if (/^https?:\/\//i.test(s)) {
    if (/\.supabase\.co\/storage\/v1\/object\/public\//i.test(s)) {
      return { kind: "legacy-public-url", url: s };
    }
    if (/\/uploads\//i.test(s)) {
      return { kind: "legacy-disk-url", url: s };
    }
    return { kind: "legacy-public-url", url: s };
  }

  if (s.startsWith("/uploads/")) {
    return { kind: "legacy-disk-url", url: s };
  }

  // Bare relative disk path used in some legacy rows.
  if (s.startsWith("uploads/kyc/")) {
    return { kind: "legacy-disk-url", url: `/${s}` };
  }

  return null;
}

export function legacyPublicUrlToObjectPath(publicUrl: string): { bucket: string; objectPath: string } | null {
  return parseSupabasePublicStorageUrl(publicUrl);
}

/**
 * Resolve a stored KYC reference to a destroyable target scoped to `businessId`.
 * Rejects DSAR paths, cross-tenant paths, and unrecognized formats (fail-closed).
 */
export type KycDestroyTarget =
  | { kind: "remote"; bucket: string; objectPath: string; sourceRef: string }
  | { kind: "disk"; relativePath: string; sourceRef: string };

export type KycDestroyResolveResult =
  | { ok: true; target: KycDestroyTarget }
  | { ok: false; reason: string };

export function resolveKycDestroyTarget(
  businessId: string,
  rawRef: string,
  kycBucketName: string,
): KycDestroyResolveResult {
  const biz = String(businessId ?? "").trim();
  const raw = String(rawRef ?? "").trim();
  if (!biz || !raw) return { ok: false, reason: "empty_ref_or_business" };

  const parsed = parseKycStorageReference(raw);
  if (!parsed) return { ok: false, reason: "unrecognized_ref" };

  if (parsed.kind === "kyc-object") {
    if (parsed.businessId !== biz) return { ok: false, reason: "cross_business_ref" };
    if (parsed.bucket !== kycBucketName) return { ok: false, reason: "unexpected_bucket" };
    if (!isAllowedKycObjectPathForBusiness(biz, parsed.objectPath)) {
      return { ok: false, reason: "path_not_allowlisted" };
    }
    return {
      ok: true,
      target: { kind: "remote", bucket: parsed.bucket, objectPath: parsed.objectPath, sourceRef: raw },
    };
  }

  if (parsed.kind === "kyc-disk") {
    if (parsed.businessId !== biz) return { ok: false, reason: "cross_business_ref" };
    if (!isAllowedKycDiskPathForBusiness(biz, parsed.relativePath)) {
      return { ok: false, reason: "path_not_allowlisted" };
    }
    return {
      ok: true,
      target: { kind: "disk", relativePath: parsed.relativePath, sourceRef: raw },
    };
  }

  if (parsed.kind === "legacy-disk-url") {
    let pathPart = parsed.url;
    try {
      if (/^https?:\/\//i.test(parsed.url)) {
        pathPart = new URL(parsed.url).pathname;
      }
    } catch {
      return { ok: false, reason: "invalid_legacy_url" };
    }
    const rel = pathPart.replace(/^\/+/, "");
    // Accept /uploads/kyc/{biz}/... only — never arbitrary /uploads/platform logos.
    if (!isAllowedKycDiskPathForBusiness(biz, rel)) {
      return { ok: false, reason: "legacy_path_not_allowlisted" };
    }
    return { ok: true, target: { kind: "disk", relativePath: rel, sourceRef: raw } };
  }

  // legacy-public-url: only if it points at verification/{biz}/ in the KYC bucket.
  const fromUrl = legacyPublicUrlToObjectPath(parsed.url);
  if (!fromUrl) return { ok: false, reason: "legacy_public_unparseable" };
  if (fromUrl.bucket !== kycBucketName) return { ok: false, reason: "legacy_public_unexpected_bucket" };
  if (!isAllowedKycObjectPathForBusiness(biz, fromUrl.objectPath)) {
    return { ok: false, reason: "legacy_public_path_not_allowlisted" };
  }
  return {
    ok: true,
    target: { kind: "remote", bucket: fromUrl.bucket, objectPath: fromUrl.objectPath, sourceRef: raw },
  };
}
