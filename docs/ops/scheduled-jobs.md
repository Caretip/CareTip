# Scheduled jobs

`backend/src/config/internalJobs.manifest.ts` is the list of record. `npm run test:security-hardening-unit` fails if a route and the manifest disagree, if `render.yaml` declares anything beyond the eight approved jobs, or if the project rule against declaring destructive jobs there is removed.

A job missing from `render.yaml` may still run as a service created in the Render Dashboard. Identify a job by its `CARE_TIP_INTERNAL_JOB_PATH`, never by its service name, and check the dashboard before creating anything.

All jobs are `POST /api/internal/jobs/<name>` with `x-cron-secret`. Every call is recorded in the audit log as `internal_job.run` with its path, status and duration.

## What is safe to schedule

Jobs marked `destructive` in the manifest change nothing until their flags are set on the web service. Without them they report what they would do.

| Flag | Allows |
|---|---|
| `DATA_LIFECYCLE_V1` | Lifecycle work at all |
| `DATA_LIFECYCLE_DRY_RUN` | Forces report-only mode |
| `DATA_LIFECYCLE_ANONYMIZATION_EXECUTE` | Account erasure |
| `DATA_LIFECYCLE_KYC_DESTROY_EXECUTE` | KYC document destruction |
| `DATA_LIFECYCLE_TOMBSTONE_EXECUTE` | Closing out businesses |
| `DATA_LIFECYCLE_*_EXECUTE` | Each retention category |

**Before turning on any `_EXECUTE` flag:** confirm the retention periods with a legal adviser, run the job in dry-run on production data, and review the output. Financial records are kept, and personal fields are anonymised instead.

## Concurrency

Lifecycle jobs claim a row with a conditional update, so two runs cannot process the same item. Running workers hold a lease, and a stale lease is reclaimed on a later tick. Payout jobs use processing claims and Stripe idempotency keys.

## When a job fails

| Symptom | Check | Recovery |
|---|---|---|
| 401 from a job | `CRON_SECRET` on the cron service matches the web service | Fix the secret, the next run catches up |
| Export request stuck | `DataLifecycleJob` rows with `running` past the lease | The next `dsar-export-tick` reclaims them |
| Erasure not happening | `DATA_LIFECYCLE_V1` and the `_EXECUTE` flag | Set flags after legal confirmation |
| Payout drift reported | Reconciliation output and the platform payout operations page | Use the reconcile action, do not edit rows |
| Job timing out | Render logs for `internal_job.run` with status 5xx | Ticks are batched and resume on the next run |

Jobs are idempotent, so running one again by hand is safe, using the same `POST` and secret.

## Operator actions

Compare the Render dashboard with `render.yaml` before applying the blueprint. Don't create a service for a job that already runs.
