import { Role } from "@prisma/client";
import { prisma } from "../prisma.js";
import {
  createSignedUrlForPrivateObject,
  kycSignedUrlTtlSeconds,
  parseSupabasePublicStorageUrl,
  supabaseKycStorageBucketName,
} from "../lib/supabaseStorageClient.js";
import {
  KYC_DISK_REF_PREFIX,
  KYC_OBJECT_REF_PREFIX,
  extractBusinessIdFromPlatformVerificationPath,
  isAllowedKycObjectRef,
  isAllowedPlatformVerificationObjectPath,
  parseKycStorageReference,
} from "../lib/kycStorageReference.js";
import { readKycDiskFile } from "./upload.service.js";
import { resolvePublicApiBaseUrl } from "../config/publicApiBaseUrl.js";

export type SecureMediaAccessResult =
  | { mode: "signed"; url: string; expiresIn: number }
  | { mode: "proxy"; url: string };

export async function userCanAccessKycStorageRef(
  userId: string,
  role: Role | undefined,
  ref: string,
): Promise<boolean> {
  const parsed = parseKycStorageReference(ref);
  if (!parsed) return false;

  if (role === Role.SUPER_ADMIN) {
    const admin = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true, isActive: true },
    });
    return admin?.isPlatformAdmin === true && admin?.isActive === true;
  }

  if (role === Role.MANAGER) {
    let businessId: string | null = null;
    if (parsed.kind === "kyc-object" || parsed.kind === "kyc-disk") {
      businessId = parsed.businessId;
    } else if (parsed.kind === "legacy-public-url") {
      const object = parseSupabasePublicStorageUrl(parsed.url);
      const m = object?.objectPath.match(/^(?:platform-verification|verification)\/([^/]+)\//);
      businessId = m?.[1] ?? null;
    } else if (parsed.kind === "legacy-disk-url") {
      const m = parsed.url.match(/\/uploads\/(?:platform\/businesses|kyc)\/([^/]+)\//);
      businessId = m?.[1] ?? null;
    }
    if (!businessId) return false;
    const business = await prisma.business.findFirst({
      where: { userId, id: businessId },
      select: { id: true },
    });
    return Boolean(business);
  }

  return false;
}

export async function resolveSecureKycMediaAccess(
  ref: string,
  userId: string,
  role: Role | undefined,
): Promise<SecureMediaAccessResult> {
  const allowed = await userCanAccessKycStorageRef(userId, role, ref);
  if (!allowed) {
    throw new Error("You do not have permission to access this document.");
  }

  const parsed = parseKycStorageReference(ref);
  if (!parsed) {
    throw new Error("Invalid document reference.");
  }

  if (parsed.kind === "kyc-object") {
    if (!isAllowedKycObjectRef(parsed.bucket, parsed.objectPath, parsed.businessId)) {
      throw new Error("Invalid document reference.");
    }
    const url = await createSignedUrlForPrivateObject(parsed.bucket, parsed.objectPath);
    return { mode: "signed", url, expiresIn: kycSignedUrlTtlSeconds() };
  }

  if (parsed.kind === "kyc-disk") {
    const base = resolvePublicApiBaseUrl().replace(/\/+$/, "");
    const url = `${base}/api/media/secure-stream?ref=${encodeURIComponent(ref)}`;
    return { mode: "proxy", url };
  }

  if (parsed.kind === "legacy-public-url") {
    const object = parseSupabasePublicStorageUrl(parsed.url);
    if (object && object.bucket === supabaseKycStorageBucketName()) {
      const biz =
        extractBusinessIdFromPlatformVerificationPath(object.objectPath) ??
        object.objectPath.match(/^verification\/([^/]+)\//)?.[1] ??
        null;
      const pathOk =
        biz &&
        (isAllowedPlatformVerificationObjectPath(biz, object.objectPath) ||
          isAllowedKycObjectRef(object.bucket, object.objectPath, biz));
      if (!pathOk) {
        throw new Error("Invalid document reference.");
      }
      const url = await createSignedUrlForPrivateObject(object.bucket, object.objectPath);
      return { mode: "signed", url, expiresIn: kycSignedUrlTtlSeconds() };
    }
    return { mode: "signed", url: parsed.url, expiresIn: 0 };
  }

  if (parsed.kind === "legacy-disk-url") {
    const base = resolvePublicApiBaseUrl().replace(/\/+$/, "");
    const absolute = parsed.url.startsWith("http")
      ? parsed.url
      : `${base}${parsed.url.startsWith("/") ? parsed.url : `/${parsed.url}`}`;
    return { mode: "proxy", url: absolute };
  }

  throw new Error("Unsupported document reference.");
}

export function isSecureKycReference(ref: string): boolean {
  const s = ref.trim();
  return s.startsWith(KYC_OBJECT_REF_PREFIX) || s.startsWith(KYC_DISK_REF_PREFIX);
}

export function loadKycDiskStreamPayload(ref: string): { buffer: Buffer; contentType: string } {
  const parsed = parseKycStorageReference(ref);
  if (!parsed || parsed.kind !== "kyc-disk") {
    throw new Error("Invalid document reference.");
  }
  return readKycDiskFile(parsed.relativePath, parsed.businessId);
}
