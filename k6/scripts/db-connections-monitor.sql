-- k6 부하 테스트 중 DB 커넥션 상태 모니터링
-- 사용법: watch -n 1 'PGPASSWORD=test psql -h localhost -p 5433 -U test -d codiit_test -f k6/scripts/db-connections-monitor.sql'

-- 1. 전체 커넥션 상태 요약
SELECT
  state,
  count(*) AS count
FROM pg_stat_activity
WHERE datname = 'codiit_test'
  AND pid != pg_backend_pid()
GROUP BY state
ORDER BY count DESC;

-- 2. 활성/대기 커넥션 상세 (idle 제외)
SELECT
  pid,
  state,
  wait_event_type,
  wait_event,
  left(query, 80) AS query_preview
FROM pg_stat_activity
WHERE datname = 'codiit_test'
  AND pid != pg_backend_pid()
  AND state != 'idle'
ORDER BY state;

-- 3. advisory lock 대기 수
SELECT count(*) AS advisory_lock_waiting
FROM pg_stat_activity
WHERE datname = 'codiit_test'
  AND wait_event_type = 'Lock'
  AND wait_event = 'advisory';
