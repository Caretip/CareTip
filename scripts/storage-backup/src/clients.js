// @ts-check
import { S3Client } from "@aws-sdk/client-s3";

/**
 * S3-compatible client for Supabase Storage or Backblaze B2.
 * Checksums are only computed when an operation requires them: neither provider reliably supports
 * the SDK's default aws-chunked trailing checksums. Integrity is enforced via Content-MD5 instead.
 * @param {import("./config.js").S3EndpointConfig} endpoint
 * @param {{ requestTimeoutMs: number }} opts
 */
export function createS3Client(endpoint, opts) {
  return new S3Client({
    endpoint: endpoint.endpoint,
    region: endpoint.region,
    credentials: {
      accessKeyId: endpoint.accessKeyId,
      secretAccessKey: endpoint.secretAccessKey,
    },
    forcePathStyle: true,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: {
      connectionTimeout: 10_000,
      requestTimeout: opts.requestTimeoutMs,
    },
  });
}
