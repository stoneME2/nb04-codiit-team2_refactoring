# k6 부하 테스트 — Advisory Lock 병목 수치화

Refresh token rotation의 PostgreSQL advisory lock이 DB 커넥션 풀을 점유하는 문제를 수치로 확인한다.

## 사전 준비

```bash
# k6 설치 (macOS)
brew install k6

# Docker 실행 확인
docker info
```

## 실행 절차

터미널 3개를 사용한다.

### 터미널 1 — 서버 시작

```bash
# 테스트 DB 시작
npm run test:db:up

# DB 초기화 + 마이그레이션 + 시드
npm run test:db:reset

# 부하 테스트용 서버 시작
npx dotenv -e .env.loadtest -- npx tsx src/server.ts
```

### 터미널 2 — DB 커넥션 모니터링

```bash
watch -n 1 'PGPASSWORD=test psql -h localhost -p 5433 -U test -d codiit_test -f k6/scripts/db-connections-monitor.sql'
```

### 터미널 3 — k6 실행

```bash
# 시나리오 A만 (동일 유저 동시 refresh — advisory lock 병목)
k6 run --env SCENARIO=same_user k6/scripts/refresh-load-test.js

# 시나리오 B만 (다수 유저 개별 refresh — 커넥션 풀 고갈)
k6 run --env SCENARIO=multi_user k6/scripts/refresh-load-test.js

# 전체 시나리오
k6 run k6/scripts/refresh-load-test.js
```

### 테스트 종료

```bash
# 서버 종료: 터미널 1에서 Ctrl+C
npm run test:db:down
```

## 시나리오 설명

### 시나리오 A: 동일 유저 동시 refresh (`concurrent_same_user`)

프론트엔드에서 access token 만료 후 여러 API가 동시에 refresh를 호출하는 상황을 재현한다.

- 모든 VU가 동일한 refreshToken으로 동시에 `POST /api/auth/refresh` 호출
- 첫 번째 요청만 성공 (토큰 rotation 완료), 나머지는 advisory lock 대기 후 401
- **관찰 포인트**: lock 대기 시간, `idle in transaction` 커넥션 수

| 단계 | VU | 기대 결과 |
|------|----|-----------|
| Phase 1-2 | 5 | 대부분 응답 빠름, 에러율 ~70% |
| Phase 3-4 | 20 | lock 대기로 p95 ~500ms, 커넥션 풀 대기 시작 |
| Phase 5-6 | 50 | p95 ~5000ms, 커넥션 풀 고갈 |

### 시나리오 B: 다수 유저 개별 refresh (`individual_users`)

서로 다른 유저들이 각자 refresh하는 상황. advisory lock은 userId별 독립이지만 커넥션 풀은 공유.

- 각 VU가 매 iteration마다 로그인 → 새 refreshToken 획득 → 즉시 refresh
- **관찰 포인트**: 커넥션 풀 경합, Prisma 타임아웃

| 단계 | VU | 기대 결과 |
|------|----|-----------|
| Phase 1-2 | 10 | 정상 동작, 에러율 ~2% |
| Phase 3-4 | 30 | 커넥션 풀 경합 시작, p95 ~800ms |
| Phase 5-6 | 50 | 커넥션 풀 포화, p95 ~3000ms |

## 결과 해석

### 핵심 지표

| 지표 | 의미 | 위험 신호 |
|------|------|-----------|
| `http_req_duration` p95 | 서버 응답 시간 | > 1000ms |
| `refresh_success` | refresh 성공 횟수 | 시나리오 A에서 매우 낮음 |
| `refresh_failed` | refresh 실패 횟수 | 시나리오 B에서 증가 시 커넥션 풀 문제 |
| DB `idle in transaction` | advisory lock 대기 커넥션 | = 커넥션 풀 크기(5)이면 풀 고갈 |
| DB `advisory_lock_waiting` | lock 대기 수 | 지속적으로 > 0이면 병목 |

### 시나리오 A 에러율이 높은 것은 정상

동일 토큰으로 동시 요청하면 1개만 성공하고 나머지는 401이다. 이것은 advisory lock의 정상 동작이다. 핵심은 **응답 시간**과 **DB 커넥션 상태**이다.

### 시나리오 B 에러율이 높으면 문제

각 유저가 독립적으로 refresh하는데 에러가 발생한다면, 커넥션 풀 고갈로 인한 타임아웃이다.

## 커스텀 메트릭

| 메트릭 | 타입 | 설명 |
|--------|------|------|
| `refresh_success` | Counter | refresh 200 응답 횟수 |
| `refresh_failed` | Counter | refresh 비-200 응답 횟수 |
| `refresh_duration` | Trend | refresh 요청 응답 시간 (ms) |

## 환경 변수

`.env.loadtest` 파일 사용. `.env.test`와의 차이점:

- `NODE_ENV=development` (rate limit 수동 제어를 위해)
- `connection_limit=5` (커넥션 풀 크기 명시)
- Rate limit 10000으로 높게 설정
