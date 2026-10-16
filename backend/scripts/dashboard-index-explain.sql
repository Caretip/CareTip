-- Replace placeholders before running (psql variables or edit literals).
-- \set employee_id '...'
-- \set business_id '...'

\timing on

\echo '=== Employee period aggregate (dashboard metrics) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT SUM(amount), COUNT(*)
FROM tips
WHERE employee_id = :'employee_id'
  AND status = 'success'
  AND created_at >= NOW() - INTERVAL '7 days'
  AND created_at <= NOW();

\echo '=== Employee period tips + chart (analytics findMany) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, amount, status, created_at
FROM tips
WHERE employee_id = :'employee_id'
  AND status = 'success'
  AND created_at >= NOW() - INTERVAL '7 days'
  AND created_at <= NOW()
ORDER BY created_at DESC
LIMIT 500;

\echo '=== Employee account hero (lifetime) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT SUM(amount) FROM tips
WHERE employee_id = :'employee_id' AND status = 'success';

\echo '=== Business period aggregate ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT SUM(amount), COUNT(*)
FROM tips
WHERE business_id = :'business_id'
  AND status = 'success'
  AND created_at >= NOW() - INTERVAL '30 days'
  AND created_at <= NOW();

\echo '=== Business groupBy employee ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT employee_id, SUM(amount), COUNT(*)
FROM tips
WHERE business_id = :'business_id'
  AND status = 'success'
  AND created_at >= NOW() - INTERVAL '30 days'
  AND created_at <= NOW()
GROUP BY employee_id;

\echo '=== Notifications unread count ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*) FROM notifications
WHERE user_id = :'user_id' AND read_at IS NULL;

\echo '=== Notifications inbox ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM notifications
WHERE user_id = :'user_id'
ORDER BY created_at DESC
LIMIT 31;

\echo '=== Refresh token revoke active ==='
EXPLAIN (ANALYZE, BUFFERS)
UPDATE refresh_tokens SET revoked_at = NOW()
WHERE user_id = :'user_id' AND revoked_at IS NULL;

\echo '=== Employee roster (business dashboard) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM employees
WHERE business_id = :'business_id'
ORDER BY is_active DESC, name ASC;
