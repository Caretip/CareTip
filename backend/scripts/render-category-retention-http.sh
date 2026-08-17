#!/bin/sh
# Render Cron Job HTTP caller for CareTip category-retention sweep/tick.
# Prefer render-category-retention-http.mjs on Render (node runtime may lack curl).
# Reads CRON_SECRET from the cron service environment. Never prints it.
# Does not set DATA_LIFECYCLE_* flags. Mutation still depends on the web service.
set -eu

if [ -z "${CRON_SECRET:-}" ]; then
  echo "CRON_SECRET is not set; refusing to call internal jobs (fail-closed)." >&2
  exit 1
fi

ORIGIN="${CARE_TIP_API_ORIGIN:-https://caretip.onrender.com}"
JOB_PATH="${CARE_TIP_INTERNAL_JOB_PATH:?CARE_TIP_INTERNAL_JOB_PATH must be set}"

# Header name must be x-cron-secret. Do not send Authorization or x-health-secret.
curl -fsS -X POST \
  -H "x-cron-secret: ${CRON_SECRET}" \
  --max-time 120 \
  "${ORIGIN}${JOB_PATH}"
echo
