# CareTip storage backup worker

A standalone job that copies Supabase Storage objects to Backblaze B2. It is designed to run as a
**Render Cron Job**, separate from the CareTip API and the existing cron services in `render.yaml`.
It shares no code, dependencies or environment variables with the app.

- **Source:** Supabase Storage through its S3-compatible endpoint (read-only: `ListObjectsV2`, `GetObject`).
- **Destination:** a Backblaze B2 bucket through its S3-compatible endpoint (additive only: `ListObjectsV2`, `HeadObject`, `PutObject`).
- **Never** deletes, moves or modifies anything in the source or the destination. Objects removed
  from Supabase stay in the backup.

## How a run works

For each configured bucket, in order:

1. List the destination prefix `{B2_PREFIX}/{bucket}/` (paginated) to learn what is already backed up.
2. Page through the source bucket (1,000 keys per page).
3. For each object, decide whether it needs copying:
   - **new:** not in the destination yet;
   - **size_changed:** the sizes differ;
   - **etag_changed / last_modified_changed:** same size, but the destination's `source-etag`
     (or `source-last-modified`) metadata differs from the source.
   Unchanged objects are skipped without reading their content.
4. Copy the object to `{B2_PREFIX}/{bucket}/{original key}` (paths preserved verbatim):
   - objects up to `BACKUP_BUFFER_LIMIT_BYTES` (64 MB by default) are read into memory, hashed,
     and uploaded with `Content-MD5`, so B2 rejects corrupted transfers. A SHA-256 is stored as metadata;
   - larger objects are streamed with an explicit `Content-Length` (5 GB S3 single-PUT limit).
5. Verify every write with `HeadObject`: size, `source-etag` and SHA-256 metadata must match.
6. Retry transient failures with exponential backoff and jitter (network errors, timeouts, HTTP 429
   and 5xx, failed verifications). Permission errors (401/403) fail immediately.

A failed object doesn't stop the run: the remaining objects and buckets are still processed. The
process exits with:

| Exit code | Meaning |
|---|---|
| `0` | every bucket succeeded (missing *optional* buckets are skipped) |
| `1` | at least one bucket failed or had failed objects, or the run was interrupted (SIGTERM) |
| `2` | invalid configuration (missing variables are named in the log; values never are) |

Render marks a cron run as failed on a non-zero exit, which triggers your Render failure notifications.

## Environment variables

Set these on the Render Cron Job only. Never commit values; `.env*` files are git-ignored.

### Required

| Variable | Description |
|---|---|
| `SUPABASE_S3_ENDPOINT` | Supabase **S3 Connection → Endpoint**, e.g. `https://<project-ref>.storage.supabase.co/storage/v1/s3` |
| `SUPABASE_S3_REGION` | Supabase **S3 Connection → Region**, e.g. `eu-central-1` |
| `SUPABASE_S3_ACCESS_KEY_ID` | Supabase S3 access key ID |
| `SUPABASE_S3_SECRET_ACCESS_KEY` | Supabase S3 secret access key |
| `B2_S3_ENDPOINT` | B2 bucket's S3 endpoint with `https://`, e.g. `https://s3.eu-central-003.backblazeb2.com` |
| `B2_S3_REGION` | Region part of the endpoint, e.g. `eu-central-003` |
| `B2_ACCESS_KEY_ID` | B2 application **keyID** |
| `B2_SECRET_ACCESS_KEY` | B2 **applicationKey** |
| `B2_BUCKET` | Destination B2 bucket name |

### Optional

| Variable | Default | Description |
|---|---|---|
| `B2_PREFIX` | `supabase-storage` | Destination prefix. Objects land at `{prefix}/{sourceBucket}/{key}`. Empty string = bucket root |
| `B2_SERVER_SIDE_ENCRYPTION` | `AES256` | Requests SSE-B2 encryption per object. `none` disables the header |
| `BACKUP_BUCKETS` | `caretip,caretip-official` | Required buckets. A missing required bucket fails the run |
| `BACKUP_OPTIONAL_BUCKETS` | *(empty)* | Optional buckets, e.g. `caretip-kyc,caretip-dsar`. Missing (not yet created) buckets are skipped with a `skipped_missing` warning; empty buckets succeed |
| `BACKUP_SENSITIVE_BUCKETS` | `caretip-kyc,caretip-dsar` | Object keys from these buckets appear in logs only as a truncated SHA-256 |
| `BACKUP_CONCURRENCY` | `4` | Parallel object transfers per bucket (1–16) |
| `BACKUP_MAX_ATTEMPTS` | `4` | Attempts per object or listing page (1–10) |
| `BACKUP_BUFFER_LIMIT_BYTES` | `67108864` | Objects up to this size are MD5/SHA-256 verified in memory; larger ones are streamed |
| `BACKUP_REQUEST_TIMEOUT_MS` | `120000` | Per-request socket timeout |
| `BACKUP_LIST_PAGE_SIZE` | `1000` | Keys per listing page (1–1000) |
| `BACKUP_DRY_RUN` | `false` | `true` = list and compare only; no object reads or writes. Also `--dry-run` |

Worst-case memory is roughly `BACKUP_CONCURRENCY × BACKUP_BUFFER_LIMIT_BYTES`, i.e. 256 MB with
the defaults. CareTip images are capped at 5–10 MB, so typical usage is far lower. On a 512 MB
Render instance, keep the defaults or lower the buffer limit.

## One-time setup

### 1. Supabase S3 credentials (source)

1. Supabase Dashboard → **Project Settings → Storage → S3 Connection**: enable the S3 connection
   and note the **Endpoint** and **Region**.
2. Under **S3 Access Keys**, create a key named `caretip-backup-render`.
3. Store the key ID and secret only in the Render Cron Job's environment.

Supabase S3 access keys have **full access to every bucket** and bypass Storage policies, just
like the service-role key. The worker only ever lists and reads, but treat these credentials as
highly sensitive and rotate them if they're exposed.

### 2. Backblaze B2 bucket and key (destination)

1. Create a **private** bucket, e.g. `caretip-storage-backup`, in an EU region.
2. Bucket settings:
   - **Default encryption:** SSE-B2 enabled.
   - **Lifecycle:** "Keep all versions" (the B2 default). A changed source object is uploaded under
     the same key, so B2 keeps the previous version instead of losing it.
   - Optional: **Object Lock** for immutability against ransomware or credential misuse.
3. Create an **application key restricted to this bucket**, with `listFiles`, `readFiles` and
   `writeFiles`. **Do not grant `deleteFiles`**: the key then cannot delete backups even if leaked.
4. The bucket's S3 endpoint is shown on the bucket page (e.g. `s3.eu-central-003.backblazeb2.com`).

## Safe testing

1. **Unit tests** (no network; in-memory mock clients only):
   ```bash
   cd scripts/storage-backup
   npm ci
   npm test
   npm run check   # syntax + TypeScript checkJs
   ```
2. **Dry run against real storage:** set the variables, plus `BACKUP_DRY_RUN=true`, on a manually
   triggered Render run (or locally in a git-ignored `.env`). It lists both sides and reports
   `wouldCopy` counts without reading object contents or writing anything.
3. **First real run into a test prefix:** set `B2_PREFIX=backup-test` and run once. Check the
   `run.finish` log and spot-check objects in the B2 browser.
4. Switch `B2_PREFIX` to its production value (or remove it) and enable the schedule.

## Deploying on Render (manual)

This repository's `render.yaml` is **not** modified. Create the job in the Render Dashboard:

| Setting | Value |
|---|---|
| Type | Cron Job |
| Runtime | Node |
| Root Directory | `scripts/storage-backup` |
| Build Command | `npm ci --omit=dev` |
| Command | `node src/index.js` |
| Schedule | e.g. `0 3 * * *` (daily 03:00 UTC) |
| Environment | the variables above, all as secret values |

If you later manage it through the Blueprint, the equivalent entry is:

```yaml
  - type: cron
    name: caretip-storage-backup
    runtime: node
    rootDir: scripts/storage-backup
    plan: starter
    buildCommand: npm ci --omit=dev
    startCommand: node src/index.js
    schedule: "0 3 * * *"
    envVars:
      - key: SUPABASE_S3_ENDPOINT
        sync: false
      - key: SUPABASE_S3_REGION
        sync: false
      - key: SUPABASE_S3_ACCESS_KEY_ID
        sync: false
      - key: SUPABASE_S3_SECRET_ACCESS_KEY
        sync: false
      - key: B2_S3_ENDPOINT
        sync: false
      - key: B2_S3_REGION
        sync: false
      - key: B2_ACCESS_KEY_ID
        sync: false
      - key: B2_SECRET_ACCESS_KEY
        sync: false
      - key: B2_BUCKET
        sync: false
```

Runs are idempotent, so a rerun only copies what is new or changed.

## Logs

One JSON object per line. The main events are:

| Event | Fields |
|---|---|
| `run.start` | buckets, destination bucket and prefix, dry-run flag, concurrency |
| `bucket.start` / `bucket.finish` | `status` (`ok`, `failed`, `skipped_missing`), `listed`, `copied`, `unchanged`, `wouldCopy`, `vanished`, `failed`, `bytesCopied`, `durationMs`, `error` (stage, name, code, HTTP status) |
| `object.retry` / `object.failed` | bucket, `keyRef`, attempt(s), error name/code/HTTP status, verification reason |
| `object.vanished` | object deleted from the source between listing and download (not a failure) |
| `run.finish` | `exitCode`, failed and skipped buckets, totals, `durationMs` |
| `config.invalid` | names of missing or invalid variables |

What the logs never contain: credentials, request signatures or URLs, object contents, error
messages from the SDK, and, for sensitive buckets, object keys (a `sha256:` reference instead).

## Restoring

Restore into a **staging** bucket first and verify before touching live buckets. The examples use
the AWS CLI with the same endpoints; any S3-compatible tool (e.g. rclone) works.

1. Download from B2:
   ```bash
   AWS_ACCESS_KEY_ID=<b2 keyID> AWS_SECRET_ACCESS_KEY=<b2 applicationKey> \
   aws s3 cp --recursive "s3://$B2_BUCKET/supabase-storage/caretip/" ./restore/caretip/ \
     --endpoint-url "$B2_S3_ENDPOINT" --region "$B2_S3_REGION"
   ```
   Older versions of a changed file: `aws s3api list-object-versions` and `get-object --version-id`.
2. Optionally compare each file's SHA-256 with the `sha256` metadata (`aws s3api head-object`).
3. Upload to Supabase (the S3 key needs write access; use a temporary key and revoke it afterwards):
   ```bash
   AWS_ACCESS_KEY_ID=<supabase key id> AWS_SECRET_ACCESS_KEY=<supabase secret> \
   aws s3 cp --recursive ./restore/caretip/ "s3://caretip/" \
     --endpoint-url "$SUPABASE_S3_ENDPOINT" --region "$SUPABASE_S3_REGION"
   ```
   Restoring overwrites existing objects with the same key. Public URLs keep working because the
   object paths are preserved.
4. Delete the local `./restore` copy afterwards, especially for KYC or DSAR data.

## Known limitations

- Source deletions are not propagated, by design. KYC and DSAR copies therefore outlive deletions
  in Supabase. Before adding `caretip-kyc` or `caretip-dsar`, agree a retention period and add a
  B2 lifecycle rule for those prefixes so backups honour GDPR deletion and retention commitments.
- Objects larger than 5 GB are not supported (S3 single-PUT limit). CareTip uploads are ≤ 10 MB.
- Each run lists the whole source and destination; cost and time grow linearly with object count.
