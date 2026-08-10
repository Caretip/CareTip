import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "node:path";
import { randomUUID } from "crypto";
import { resolvePublicApiBaseUrl } from "../config/publicApiBaseUrl.js";
import {
  validateImageBufferForUpload,
  extensionForImageBuffer,
  isAllowedImageMimetype,
} from "../lib/imageUploadValidation.js";
import { validateVerificationDocumentBuffer } from "../lib/verificationUploadValidation.js";
import {
  buildKycDiskStorageRef,
  buildKycObjectStorageRef,
  parseKycStorageReference,
} from "../lib/kycStorageReference.js";
import {
  isSupabaseStorageConfigured,
  supabaseStorageBucketName,
  supabaseKycStorageBucketName,
  ensureSupabaseKycBucketReady,
  uploadBufferToSupabasePublicUrl,
  uploadBufferToSupabasePrivateObject,
  warnIfSupabaseUrlButNoServiceRole,
  assertUploadedObjectReadableInBucket,
  assertPrivateObjectExists,
  removeUploadedObjectByPublicUrlIfPossible,
  removePrivateStorageObject,
  removeKycStorageObject,
  parseSupabasePublicStorageUrl,
} from "../lib/supabaseStorageClient.js";
import { buildUniqueStorageObjectNameFromExtension } from "../utils/storageObjectName.js";

const UPLOAD_CONFIG_ERROR = "File upload isn't available right now. Please try again later.";

const REMOTE_UPLOAD_TIMEOUT_MS = 90_000;

let loggedStorageBackend = false;

function isLocalhostBase(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return /\blocalhost\b/i.test(url);
  }
}

export function isSupabaseStorageConfiguredForUpload(): boolean {
  return isSupabaseStorageConfigured();
}

export function getImageUploadStorageDiagnostics(): {
  employeeAvatarStorage: "supabase" | "disk";
  supabaseStorageConfigured: boolean;
  supabaseStorageBucket?: string;
  kycStorageBucket?: string;
} {
  const supabaseStorageConfigured = isSupabaseStorageConfiguredForUpload();
  return {
    employeeAvatarStorage: supabaseStorageConfigured ? "supabase" : "disk",
    supabaseStorageConfigured,
    ...(supabaseStorageConfigured
      ? {
          supabaseStorageBucket: supabaseStorageBucketName(),
          kycStorageBucket: supabaseKycStorageBucketName(),
        }
      : {}),
  };
}

function logStorageBackendOnce(): void {
  if (loggedStorageBackend) return;
  loggedStorageBackend = true;
  warnIfSupabaseUrlButNoServiceRole();
  const d = getImageUploadStorageDiagnostics();
  console.info(
    `[upload] Employee avatars: storage=${d.employeeAvatarStorage} (SUPABASE_URL+SERVICE_ROLE_KEY=${d.supabaseStorageConfigured})`,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function assertDiskFileExists(absolutePath: string): void {
  if (!existsSync(absolutePath)) {
    throw new Error("Saved file is missing on disk.");
  }
}

async function uploadBufferToSupabaseWithTimeout(
  objectKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  return withTimeout(
    uploadBufferToSupabasePublicUrl(objectKey, buffer, contentType),
    REMOTE_UPLOAD_TIMEOUT_MS,
    "Supabase storage upload",
  );
}

export async function uploadEmployeeAvatarImage(buffer: Buffer, mimetype: string): Promise<string> {
  logStorageBackendOnce();
  validateImageBufferForUpload(buffer, mimetype);
  const ext = extensionForImageBuffer(buffer);
  const name = buildUniqueStorageObjectNameFromExtension(ext);

  if (isSupabaseStorageConfiguredForUpload()) {
    try {
      const objectKey = `avatars/${name}`;
      const publicUrl = await uploadBufferToSupabaseWithTimeout(objectKey, buffer, mimetype);
      await assertUploadedObjectReadableInBucket(publicUrl);
      return publicUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] Supabase employee avatar failed:", msg);
      if (/timed out/i.test(msg)) {
        throw new Error("Photo upload timed out. Please try again with a smaller image.");
      }
      throw new Error("We couldn't upload your photo. Please try a JPEG or PNG under 5 MB.");
    }
  }

  const base = resolvePublicApiBaseUrl();
  if (process.env.NODE_ENV === "production" && isLocalhostBase(base)) {
    throw new Error(UPLOAD_CONFIG_ERROR);
  }
  const filename = `${randomUUID()}${ext}`;
  const dir = path.join(process.cwd(), "uploads", "avatars");
  const fp = path.join(dir, filename);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(fp, buffer);
    assertDiskFileExists(fp);
  } catch (e) {
    console.error("[upload] Disk write failed (ephemeral or read-only filesystem?)", e);
    throw new Error(UPLOAD_CONFIG_ERROR);
  }
  const baseNorm = base.replace(/\/$/, "");
  return `${baseNorm}/uploads/avatars/${filename}`;
}

export async function uploadManagerBusinessLogoImage(
  buffer: Buffer,
  mimetype: string,
  businessId: string,
): Promise<string> {
  logStorageBackendOnce();
  validateImageBufferForUpload(buffer, mimetype);
  const safeBizId = businessId.replace(/[^a-zA-Z0-9-_]/g, "");
  const ext = extensionForImageBuffer(buffer);
  const name = buildUniqueStorageObjectNameFromExtension(ext);

  if (isSupabaseStorageConfiguredForUpload()) {
    try {
      const objectKey = `business-logos/${name}`;
      const publicUrl = await uploadBufferToSupabaseWithTimeout(objectKey, buffer, mimetype);
      await assertUploadedObjectReadableInBucket(publicUrl);
      return publicUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] manager business logo (Supabase) failed:", msg);
      if (/timed out/i.test(msg)) {
        throw new Error("Logo upload timed out. Try again with a smaller image.");
      }
      throw new Error(msg.includes("logo") ? msg : "We couldn't save your logo. Please try again.");
    }
  }

  const base = resolvePublicApiBaseUrl();
  if (process.env.NODE_ENV === "production" && isLocalhostBase(base)) {
    throw new Error(UPLOAD_CONFIG_ERROR);
  }
  const relDir = path.join("uploads", "businesses", safeBizId);
  const dir = path.join(process.cwd(), relDir);
  const fp = path.join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fp, buffer);
  assertDiskFileExists(fp);
  const baseNorm = base.replace(/\/$/, "");
  const relUrl = `${relDir.replace(/\\/g, "/")}/${name}`;
  return `${baseNorm}/${relUrl}`;
}

/** Venue hero banner for premium guest landing — max validated in multer (8 MB). */
export async function uploadManagerBusinessBannerImage(
  buffer: Buffer,
  mimetype: string,
  businessId: string,
): Promise<string> {
  logStorageBackendOnce();
  validateImageBufferForUpload(buffer, mimetype);
  const safeBizId = businessId.replace(/[^a-zA-Z0-9-_]/g, "");
  const ext = extensionForImageBuffer(buffer);
  const name = buildUniqueStorageObjectNameFromExtension(ext);

  if (isSupabaseStorageConfiguredForUpload()) {
    try {
      const objectKey = `business-banners/${name}`;
      const publicUrl = await uploadBufferToSupabaseWithTimeout(objectKey, buffer, mimetype);
      await assertUploadedObjectReadableInBucket(publicUrl);
      return publicUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] manager business banner (Supabase) failed:", msg);
      if (/timed out/i.test(msg)) {
        throw new Error("Banner upload timed out. Try again with a smaller image.");
      }
      throw new Error(msg.includes("banner") ? msg : "We couldn't save your banner. Please try again.");
    }
  }

  const base = resolvePublicApiBaseUrl();
  if (process.env.NODE_ENV === "production" && isLocalhostBase(base)) {
    throw new Error(UPLOAD_CONFIG_ERROR);
  }
  const relDir = path.join("uploads", "businesses", safeBizId, "banners");
  const dir = path.join(process.cwd(), relDir);
  const fp = path.join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fp, buffer);
  assertDiskFileExists(fp);
  const baseNorm = base.replace(/\/$/, "");
  const relUrl = `${relDir.replace(/\\/g, "/")}/${name}`;
  return `${baseNorm}/${relUrl}`;
}

export async function uploadPlatformBusinessLogoImage(
  buffer: Buffer,
  mimetype: string,
  businessId: string,
): Promise<string> {
  logStorageBackendOnce();
  validateImageBufferForUpload(buffer, mimetype);
  const safeBizId = businessId.replace(/[^a-zA-Z0-9-_]/g, "");
  const ext = extensionForImageBuffer(buffer);
  const name = buildUniqueStorageObjectNameFromExtension(ext);

  if (isSupabaseStorageConfiguredForUpload()) {
    try {
      const objectKey = `platform-logos/${safeBizId}/${name}`;
      const publicUrl = await uploadBufferToSupabaseWithTimeout(objectKey, buffer, mimetype);
      await assertUploadedObjectReadableInBucket(publicUrl);
      return publicUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] platform business logo (Supabase) failed:", msg);
      throw new Error("We couldn't save your logo. Please try again.");
    }
  }

  const base = resolvePublicApiBaseUrl();
  if (process.env.NODE_ENV === "production" && isLocalhostBase(base)) {
    throw new Error(UPLOAD_CONFIG_ERROR);
  }
  const relDir = path.join("uploads", "platform", "businesses", safeBizId);
  const dir = path.join(process.cwd(), relDir);
  const fp = path.join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fp, buffer);
  assertDiskFileExists(fp);
  const baseNorm = base.replace(/\/$/, "");
  const relUrl = `${relDir.replace(/\\/g, "/")}/${name}`;
  return `${baseNorm}/${relUrl}`;
}

/** Manager self-service KYC — private storage reference (not a public URL). */
export async function uploadManagerVerificationDocument(
  buffer: Buffer,
  _mimetype: string,
  businessId: string,
): Promise<string> {
  return uploadPlatformVerificationDocument(buffer, _mimetype, businessId);
}

/**
 * Stores KYC / verification documents in private storage.
 * Returns `kyc-object:{bucket}/{path}` or `kyc-disk:uploads/kyc/...` — never a permanent public URL.
 */
export async function uploadPlatformVerificationDocument(
  buffer: Buffer,
  _claimedMimetype: string,
  businessId: string,
): Promise<string> {
  warnIfSupabaseUrlButNoServiceRole();
  const validated = validateVerificationDocumentBuffer(buffer);
  const safeBizId = businessId.replace(/[^a-zA-Z0-9-_]/g, "");
  const name = buildUniqueStorageObjectNameFromExtension(validated.extension);
  const objectPath = `verification/${safeBizId}/${name}`;

  if (isSupabaseStorageConfiguredForUpload()) {
    try {
      const bucket = supabaseKycStorageBucketName();
      await ensureSupabaseKycBucketReady();
      const uploaded = await withTimeout(
        uploadBufferToSupabasePrivateObject(bucket, objectPath, buffer, validated.contentType),
        REMOTE_UPLOAD_TIMEOUT_MS,
        "Supabase KYC upload",
      );
      await assertPrivateObjectExists(uploaded.bucket, uploaded.objectPath);
      return buildKycObjectStorageRef(uploaded.bucket, uploaded.objectPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[upload] platform verification (Supabase private) failed:", msg);
      throw new Error("We couldn't save your verification file. Please try again.");
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Verification upload is not available. Configure Supabase Storage (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  const base = resolvePublicApiBaseUrl();
  if (isLocalhostBase(base)) {
    throw new Error(UPLOAD_CONFIG_ERROR);
  }

  const relDir = path.join("uploads", "kyc", safeBizId);
  const dir = path.join(process.cwd(), relDir);
  const fp = path.join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fp, buffer);
  assertDiskFileExists(fp);
  return buildKycDiskStorageRef(`${relDir.replace(/\\/g, "/")}/${name}`);
}

/** Best-effort cleanup for failed DB writes or rollbacks. */
export async function removeStoredUploadReferenceIfPossible(storedRef: string): Promise<void> {
  const parsed = parseKycStorageReference(storedRef);
  if (!parsed) {
    await removeUploadedObjectByPublicUrlIfPossible(storedRef);
    return;
  }
  if (parsed.kind === "kyc-object") {
    // Prefer KYC-scoped helper (refuses DSAR bucket / paths). Best-effort: no requireConfigured.
    await removeKycStorageObject(parsed.bucket, parsed.objectPath);
    return;
  }
  if (parsed.kind === "kyc-disk") {
    try {
      const fp = path.join(process.cwd(), parsed.relativePath);
      if (existsSync(fp)) {
        const { unlinkSync } = await import("fs");
        unlinkSync(fp);
      }
    } catch {
      /* ignore */
    }
  }
}

export function readKycDiskFile(relativePath: string): { buffer: Buffer; contentType: string } {
  const fp = path.join(process.cwd(), relativePath);
  if (!existsSync(fp)) {
    throw new Error("Document not found.");
  }
  const buffer = readFileSync(fp);
  const ext = path.extname(fp).toLowerCase();
  const contentType =
    ext === ".pdf"
      ? "application/pdf"
      : ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : "image/jpeg";
  return { buffer, contentType };
}

export { isAllowedImageMimetype };
