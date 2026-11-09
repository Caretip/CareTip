// In-memory S3 stand-in for tests. Never touches the network.
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

export function s3Error(name, httpStatusCode, extra = {}) {
  const err = new Error(`${name} (mock)`);
  err.name = name;
  err.$metadata = { httpStatusCode };
  Object.assign(err, extra);
  return err;
}

async function bodyToBuffer(body) {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  if (body && typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const c of body) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  }
  throw new Error("unsupported body in mock");
}

export class MockS3 {
  /**
   * @param {string} label
   * @param {{ fault?: (commandName: string, input: any, callIndex: number) => Error | undefined, headOverride?: (input: any, head: any) => any }} [opts]
   */
  constructor(label, opts = {}) {
    this.label = label;
    this.buckets = new Map();
    this.calls = [];
    this.fault = opts.fault;
    this.headOverride = opts.headOverride;
  }

  createBucket(name) {
    if (!this.buckets.has(name)) this.buckets.set(name, new Map());
    return this;
  }

  putRaw(bucket, key, body, extra = {}) {
    this.createBucket(bucket);
    const buf = Buffer.from(body);
    this.buckets.get(bucket).set(key, {
      body: buf,
      etag: `"${createHash("md5").update(buf).digest("hex")}"`,
      lastModified: extra.lastModified ?? new Date("2026-11-01T10:00:00.000Z"),
      contentType: extra.contentType ?? "application/octet-stream",
      cacheControl: extra.cacheControl,
      metadata: extra.metadata ?? {},
      serverSideEncryption: extra.serverSideEncryption,
    });
    return this;
  }

  get(bucket, key) {
    return this.buckets.get(bucket)?.get(key);
  }

  callNames() {
    return [...new Set(this.calls.map((c) => c.name))];
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    const callIndex = this.calls.length;
    this.calls.push({ name, input });
    const injected = this.fault?.(name, input, callIndex);
    if (injected) throw injected;
    const bucket = this.buckets.get(input.Bucket);
    if (!bucket) throw s3Error("NoSuchBucket", 404);

    switch (name) {
      case "ListObjectsV2Command": {
        const keys = [...bucket.keys()].filter((k) => !input.Prefix || k.startsWith(input.Prefix)).sort();
        const start = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
        const max = input.MaxKeys ?? 1000;
        const slice = keys.slice(start, start + max);
        const truncated = start + max < keys.length;
        return {
          Contents: slice.map((k) => {
            const o = bucket.get(k);
            return { Key: k, Size: o.body.length, ETag: o.etag, LastModified: o.lastModified };
          }),
          IsTruncated: truncated,
          NextContinuationToken: truncated ? String(start + max) : undefined,
        };
      }
      case "GetObjectCommand": {
        const o = bucket.get(input.Key);
        if (!o) throw s3Error("NoSuchKey", 404);
        const stream = Readable.from([o.body]);
        stream.transformToByteArray = async () => new Uint8Array(o.body);
        return {
          Body: stream,
          ContentLength: o.body.length,
          ETag: o.etag,
          LastModified: o.lastModified,
          ContentType: o.contentType,
          CacheControl: o.cacheControl,
        };
      }
      case "HeadObjectCommand": {
        const o = bucket.get(input.Key);
        if (!o) throw s3Error("NotFound", 404);
        const head = { ContentLength: o.body.length, ETag: o.etag, Metadata: { ...o.metadata } };
        return this.headOverride ? this.headOverride(input, head) : head;
      }
      case "PutObjectCommand": {
        const buf = await bodyToBuffer(input.Body);
        if (input.ContentLength !== undefined && input.ContentLength !== buf.length) {
          throw s3Error("IncompleteBody", 400);
        }
        if (input.ContentMD5 && createHash("md5").update(buf).digest("base64") !== input.ContentMD5) {
          throw s3Error("BadDigest", 400);
        }
        this.putRaw(input.Bucket, input.Key, buf, {
          contentType: input.ContentType,
          cacheControl: input.CacheControl,
          metadata: input.Metadata ?? {},
          serverSideEncryption: input.ServerSideEncryption,
        });
        return { ETag: bucket.get(input.Key).etag };
      }
      default:
        throw new Error(`MockS3(${this.label}) does not implement ${name}`);
    }
  }
}
