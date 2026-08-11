import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const VERIFICATION_MAX_BYTES = 10 * 1024 * 1024;

let _client: SupabaseClient | null = null;
let warnedMissingServiceRole = false;
let bucketReadyPromise: Promise<void> | null = null;

function describeStorageError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const e = error as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof e.message === "string" && e.message.trim()) parts.push(e.message.trim());
  if (e.statusCode != null && String(e.statusCode).trim()) parts.push(`status=${String(e.statusCode)}`);
  if (typeof e.error === "string" && e.error.trim()) parts.push(e.error.trim());
  if (typeof e.name === "string" && e.name.trim()) parts.push(`name=${e.name.trim()}`);
  return parts.length > 0 ? parts.join(" | ") : JSON.stringify(error);
}

function clientMessageForStorageUploadError(detail: string): string {
  const d = detail.toLowerCase();
  if (/bucket not found|nosuchbucket|does not exist/.test(d)) {
    return "File upload isn't available right now. Please try again later.";
  }
  if (/invalid jwt|invalid api key|unauthorized|jwt expired|invalid signature/.test(d)) {
    return "File upload isn't available right now. Please try again later.";
  }
  if (/payload too large|entity too large|file size limit|exceeded/.test(d)) {
    return "Image is too large (max 5 MB).";
  }
  if (/already exists|duplicate/.test(d)) {
    return "We couldn't save your file. Please try again.";
  }
  return "We couldn't save your file. Please try again.";
}

function normalizeImageContentType(contentType: string): string {
  const mt = contentType.trim().toLowerCase();
  if (!mt) return "application/octet-stream";
  if (mt === "image/jpg") return "image/jpeg";
  if (mt.includes("heic") || mt.includes("heif")) return "image/heic";
  return contentType.trim();
}

/**
 * Project URL only — e.g. `https://abcdefgh.supabase.co`.
 * Do NOT append `/rest/v1/` (the SDK adds API paths). Strips common copy-paste mistakes.
 */
function normalizeSupabaseProjectUrl(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  let s = raw.trim().replace(/\/+$/, "");
  const m = s.match(/https?:\/\/[a-z0-9-]+\.supabase\.co/i);
  if (m?.[0]) {
    s = m[0].replace(/\/+$/, "");
  } else {
    s = s.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  }
  try {
    const u = new URL(s);
    if (!/\.supabase\.co$/i.test(u.hostname)) return undefined;
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

/** Same project URL as the dashboard; SPA often sets `NEXT_PUBLIC_SUPABASE_URL` only. */
function supabaseProjectUrl(): string | undefined {
  return (
    normalizeSupabaseProjectUrl(process.env.SUPABASE_URL) ??
    normalizeSupabaseProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  );
}

/** Service role only — never the anon key (anon cannot replace server-side Storage uploads in our flow). */
function supabaseServiceRoleKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE?.trim() ||
    undefined
  );
}

export function isSupabaseStorageConfigured(): boolean {
  return Boolean(supabaseProjectUrl() && supabaseServiceRoleKey());
}

/** Log once when URL exists but service role is missing (common misconfig after adding only `NEXT_PUBLIC_*`). */
export function warnIfSupabaseUrlButNoServiceRole(): void {
  if (warnedMissingServiceRole) return;
  if (!supabaseProjectUrl() || supabaseServiceRoleKey()) return;
  warnedMissingServiceRole = true;
  console.warn(
    "[upload] Supabase Storage disabled: set SUPABASE_SERVICE_ROLE_KEY in backend/root .env (Dashboard → Settings → API → service_role). " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY cannot be used for server uploads; without the service role, logos stay on disk only.",
  );
}

/** Default `caretip` — public read for logos/avatars. */
export function supabaseStorageBucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || "caretip";
}

/** Private bucket for KYC / verification documents (signed URL access only). */
export function supabaseKycStorageBucketName(): string {
  return process.env.SUPABASE_KYC_STORAGE_BUCKET?.trim() || "caretip-kyc";
}

/**
 * Dedicated private bucket for DSAR export artifacts (Slice E remediation).
 * Never share the KYC bucket for DSAR objects.
 */
export function supabaseDsarStorageBucketName(): string {
  return process.env.SUPABASE_DSAR_STORAGE_BUCKET?.trim() || "caretip-dsar";
}

/** DSAR object keys must live under exports/{userId}/{jobId}.json — never KYC paths. */
export function isAllowedDsarObjectPath(objectPath: string): boolean {
  const key = objectPath.replace(/^\/+/, "").replace(/\/+/g, "/");
  return /^exports\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.json$/.test(key);
}

export function assertAllowedDsarObjectPath(objectPath: string): string {
  const key = objectPath.replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!isAllowedDsarObjectPath(key)) {
    throw new Error("Invalid DSAR storage path");
  }
  return key;
}

export function kycSignedUrlTtlSeconds(): number {
  const raw = Number(process.env.KYC_SIGNED_URL_TTL_SECONDS ?? 300);
  if (!Number.isFinite(raw) || raw < 60 || raw > 3600) return 300;
  return Math.floor(raw);
}

let kycBucketReadyPromise: Promise<void> | null = null;
let dsarBucketReadyPromise: Promise<void> | null = null;

/**
 * Ensures the configured bucket exists (public read). Safe to call before every upload — runs once per process.
 * Requires `SUPABASE_SERVICE_ROLE_KEY` (anon key cannot create buckets or bypass storage RLS).
 */
export async function ensureSupabaseStorageBucketReady(): Promise<void> {
  if (!isSupabaseStorageConfigured()) return;
  if (bucketReadyPromise) return bucketReadyPromise;

  bucketReadyPromise = (async () => {
    const supabase = getServiceClient();
    const bucket = supabaseStorageBucketName();

    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      const detail = describeStorageError(listErr);
      console.error("[upload] Supabase listBuckets failed:", detail);
      throw new Error("File upload isn't available right now. Please try again later.");
    }

    if (buckets?.some((b) => b.name === bucket)) {
      return;
    }

    console.info(`[upload] Supabase bucket "${bucket}" not found — creating (public read).`);
    const { error: createErr } = await supabase.storage.createBucket(bucket, {
      public: true,
      fileSizeLimit: AVATAR_MAX_BYTES,
    });

    if (createErr) {
      const detail = describeStorageError(createErr);
      if (/already exists|duplicate/i.test(detail)) {
        return;
      }
      console.error(`[upload] Supabase createBucket("${bucket}") failed:`, detail);
      console.error(
        `[upload] Create a **public** bucket named "${bucket}" in Supabase Dashboard → Storage, ` +
          `or set SUPABASE_STORAGE_BUCKET to match an existing bucket. ` +
          `Uploads require SUPABASE_SERVICE_ROLE_KEY (not the anon key).`,
      );
      throw new Error("File upload isn't available right now. Please try again later.");
    }

    console.info(`[upload] Supabase bucket "${bucket}" created.`);
  })();

  return bucketReadyPromise;
}

/** Ensures the private KYC bucket exists (no public read). */
export async function ensureSupabaseKycBucketReady(): Promise<void> {
  if (!isSupabaseStorageConfigured()) return;
  if (kycBucketReadyPromise) return kycBucketReadyPromise;

  kycBucketReadyPromise = (async () => {
    const supabase = getServiceClient();
    const bucket = supabaseKycStorageBucketName();

    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      const detail = describeStorageError(listErr);
      console.error("[upload] Supabase listBuckets (KYC) failed:", detail);
      throw new Error("File upload isn't available right now. Please try again later.");
    }

    if (buckets?.some((b) => b.name === bucket)) {
      return;
    }

    console.info(`[upload] Supabase KYC bucket "${bucket}" not found — creating (private).`);
    const { error: createErr } = await supabase.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: VERIFICATION_MAX_BYTES,
    });

    if (createErr) {
      const detail = describeStorageError(createErr);
      if (/already exists|duplicate/i.test(detail)) {
        return;
      }
      console.error(`[upload] Supabase createBucket KYC("${bucket}") failed:`, detail);
      throw new Error("File upload isn't available right now. Please try again later.");
    }

    console.info(`[upload] Supabase KYC bucket "${bucket}" created (private).`);
  })();

  return kycBucketReadyPromise;
}

/** Ensures the private DSAR export bucket exists (no public read). Isolated from KYC. */
export async function ensureSupabaseDsarBucketReady(): Promise<void> {
  if (!isSupabaseStorageConfigured()) return;
  if (dsarBucketReadyPromise) return dsarBucketReadyPromise;

  dsarBucketReadyPromise = (async () => {
    const supabase = getServiceClient();
    const bucket = supabaseDsarStorageBucketName();

    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (listErr) {
      const detail = describeStorageError(listErr);
      console.error("[upload] Supabase listBuckets (DSAR) failed:", detail);
      throw new Error("File upload isn't available right now. Please try again later.");
    }

    if (buckets?.some((b) => b.name === bucket)) {
      return;
    }

    console.info(`[upload] Supabase DSAR bucket "${bucket}" not found — creating (private).`);
    const { error: createErr } = await supabase.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: VERIFICATION_MAX_BYTES,
    });

    if (createErr) {
      const detail = describeStorageError(createErr);
      if (/already exists|duplicate/i.test(detail)) {
        return;
      }
      console.error(`[upload] Supabase createBucket DSAR("${bucket}") failed:`, detail);
      throw new Error("File upload isn't available right now. Please try again later.");
    }

    console.info(`[upload] Supabase DSAR bucket "${bucket}" created (private).`);
  })();

  return dsarBucketReadyPromise;
}

function getServiceClient(): SupabaseClient {
  if (!isSupabaseStorageConfigured()) {
    throw new Error("File upload isn't available right now. Please try again later.");
  }
  if (!_client) {
    _client = createClient(supabaseProjectUrl()!, supabaseServiceRoleKey()!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

/**
 * Upload bytes to `bucket/objectKey` and return the **public** object URL (bucket must allow public read,
 * or expose objects via your CDN — same pattern as Cloudinary `secure_url`).
 */
export async function uploadBufferToSupabasePublicUrl(
  objectKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  await ensureSupabaseStorageBucketReady();

  const bucket = supabaseStorageBucketName();
  const key = objectKey.replace(/^\/+/, "").replace(/\/+/g, "/");
  const supabase = getServiceClient();
  const normalizedType = normalizeImageContentType(contentType);

  const { error } = await supabase.storage.from(bucket).upload(key, buffer, {
    contentType: normalizedType,
    upsert: true,
    cacheControl: "3600",
  });
  if (error) {
    const detail = describeStorageError(error);
    console.error(`[upload] Supabase storage.upload bucket="${bucket}" key="${key}":`, detail);
    throw new Error(clientMessageForStorageUploadError(detail));
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  if (!data?.publicUrl) {
    console.error(`[upload] Supabase getPublicUrl returned empty for bucket="${bucket}" key="${key}"`);
    throw new Error("We couldn't save your file. Please try again.");
  }
  return data.publicUrl;
}

/**
 * Parses a `getPublicUrl` style URL: `/storage/v1/object/public/{bucket}/{objectPath}`.
 */
export function parseSupabasePublicStorageUrl(
  publicUrl: string,
): { bucket: string; objectPath: string } | null {
  try {
    const u = new URL(publicUrl.trim());
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!m?.[1] || !m[2]) return null;
    return { bucket: m[1], objectPath: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}

/**
 * Confirms the object exists in Storage using the service role (same auth as upload).
 * Call this after `uploadBufferToSupabasePublicUrl` and before persisting `logoPath` in the database.
 */
export async function assertUploadedObjectReadableInBucket(publicUrl: string): Promise<void> {
  if (!isSupabaseStorageConfigured()) {
    throw new Error("File upload isn't available right now. Please try again later.");
  }
  const parsed = parseSupabasePublicStorageUrl(publicUrl);
  if (!parsed) {
    throw new Error("We couldn't complete the upload. Please try again.");
  }
  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(parsed.bucket).download(parsed.objectPath);
  if (error) {
    const detail = describeStorageError(error);
    console.error(
      `[upload] Supabase post-upload verify failed bucket="${parsed.bucket}" path="${parsed.objectPath}":`,
      detail,
    );
    throw new Error("We couldn't confirm the upload. Please try again.");
  }
}

/** Best-effort delete after a failed DB commit (avoids orphaned objects). */
export async function removeUploadedObjectByPublicUrlIfPossible(publicUrl: string): Promise<void> {
  if (!isSupabaseStorageConfigured()) return;
  const parsed = parseSupabasePublicStorageUrl(publicUrl);
  if (!parsed) return;
  try {
    const supabase = getServiceClient();
    await supabase.storage.from(parsed.bucket).remove([parsed.objectPath]);
  } catch {
    /* ignore */
  }
}

/** Upload to a private bucket; returns `{ bucket, objectPath }` (no public URL). */
export async function uploadBufferToSupabasePrivateObject(
  bucket: string,
  objectKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ bucket: string; objectPath: string }> {
  await ensureSupabaseKycBucketReady();

  const key = objectKey.replace(/^\/+/, "").replace(/\/+/g, "/");
  const supabase = getServiceClient();
  const normalizedType = contentType.trim() || "application/octet-stream";

  const { error } = await supabase.storage.from(bucket).upload(key, buffer, {
    contentType: normalizedType,
    upsert: false,
    cacheControl: "private, max-age=0",
  });
  if (error) {
    const detail = describeStorageError(error);
    console.error(`[upload] Supabase private upload bucket="${bucket}" key="${key}":`, detail);
    throw new Error(clientMessageForStorageUploadError(detail));
  }

  return { bucket, objectPath: key };
}

export async function assertPrivateObjectExists(bucket: string, objectPath: string): Promise<void> {
  if (!isSupabaseStorageConfigured()) {
    throw new Error("File upload isn't available right now. Please try again later.");
  }
  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(bucket).download(objectPath);
  if (error) {
    throw new Error("We couldn't confirm the upload. Please try again.");
  }
}

export async function createSignedUrlForPrivateObject(
  bucket: string,
  objectPath: string,
  expiresInSeconds = kycSignedUrlTtlSeconds(),
): Promise<string> {
  if (!isSupabaseStorageConfigured()) {
    throw new Error("File access isn't available right now. Please try again later.");
  }
  const supabase = getServiceClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    const detail = error ? describeStorageError(error) : "empty signed URL";
    console.error(`[upload] Supabase createSignedUrl bucket="${bucket}" key="${objectPath}":`, detail);
    throw new Error("We couldn't access this document. Please try again.");
  }
  return data.signedUrl;
}

export async function removePrivateStorageObject(bucket: string, objectPath: string): Promise<void> {
  if (!isSupabaseStorageConfigured()) return;
  try {
    const supabase = getServiceClient();
    await supabase.storage.from(bucket).remove([objectPath]);
  } catch {
    /* ignore */
  }
}

/**
 * Upload a DSAR artifact to the dedicated private DSAR bucket.
 * Path must match exports/{userId}/{jobId}.json. Upsert for idempotent worker retries.
 */
export async function uploadBufferToSupabaseDsarObject(
  objectKey: string,
  buffer: Buffer,
  contentType = "application/json",
): Promise<{ bucket: string; objectPath: string }> {
  await ensureSupabaseDsarBucketReady();
  const bucket = supabaseDsarStorageBucketName();
  const key = assertAllowedDsarObjectPath(objectKey);
  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(bucket).upload(key, buffer, {
    contentType: contentType.trim() || "application/json",
    upsert: true,
    cacheControl: "private, max-age=0",
  });
  if (error) {
    const detail = describeStorageError(error);
    console.error(`[upload] Supabase DSAR upload bucket="${bucket}" key="${key}":`, detail);
    throw new Error(clientMessageForStorageUploadError(detail));
  }
  return { bucket, objectPath: key };
}

/**
 * Delete a single DSAR object. Refuses KYC bucket and non-allowlisted paths.
 * Isolation guards always run — even when Supabase is not configured (CI).
 */
export async function removeDsarStorageObject(bucket: string, objectPath: string): Promise<void> {
  const dsarBucket = supabaseDsarStorageBucketName();
  const kycBucket = supabaseKycStorageBucketName();
  if (bucket === kycBucket) {
    throw new Error("Refusing to delete KYC object via DSAR cleanup");
  }
  if (bucket !== dsarBucket) {
    throw new Error("Refusing DSAR cleanup for unexpected bucket");
  }
  const key = assertAllowedDsarObjectPath(objectPath);
  if (!isSupabaseStorageConfigured()) return;
  try {
    const supabase = getServiceClient();
    await supabase.storage.from(bucket).remove([key]);
  } catch {
    /* ignore missing */
  }
}

export type RemoveKycStorageObjectOptions = {
  /**
   * When true (Slice F-B secure destroy), missing Supabase config is a hard failure —
   * never treat "storage not configured" as successful deletion.
   * Default false preserves best-effort rollback helpers.
   */
  requireConfigured?: boolean;
  /** When set, object path must be under verification/{businessId}/. */
  businessId?: string;
};

/**
 * KYC-scoped delete helper — refuses DSAR bucket / exports|dsar paths / non-KYC buckets.
 * Optional businessId enforces tenant path allowlist.
 */
export async function removeKycStorageObject(
  bucket: string,
  objectPath: string,
  opts?: RemoveKycStorageObjectOptions,
): Promise<void> {
  const dsarBucket = supabaseDsarStorageBucketName();
  const kycBucket = supabaseKycStorageBucketName();
  if (bucket === dsarBucket) {
    throw new Error("Refusing to delete DSAR object via KYC cleanup");
  }
  if (bucket !== kycBucket) {
    throw new Error("Refusing KYC cleanup for unexpected bucket");
  }
  const key = objectPath.replace(/^\/+/, "").replace(/\/+/g, "/");
  if (key.startsWith("exports/") || key.startsWith("dsar/")) {
    throw new Error("Refusing to delete DSAR-prefixed path via KYC cleanup");
  }
  if (opts?.businessId) {
    const safeBiz = opts.businessId.replace(/[^a-zA-Z0-9-_]/g, "");
    if (
      !safeBiz ||
      key.includes("..") ||
      !key.startsWith(`verification/${safeBiz}/`) ||
      key.length <= `verification/${safeBiz}/`.length
    ) {
      throw new Error("Refusing KYC cleanup for path outside business allowlist");
    }
  }

  const configured = isSupabaseStorageConfigured();
  if (!configured) {
    if (opts?.requireConfigured) {
      throw new Error("KYC storage provider is not configured — refusing to claim deletion success");
    }
    return;
  }

  const supabase = getServiceClient();
  const { error } = await supabase.storage.from(bucket).remove([key]);
  if (error) {
    throw new Error(`KYC storage delete failed: ${describeStorageError(error)}`);
  }
}
