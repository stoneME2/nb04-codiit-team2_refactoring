import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// ─── 설정 ───────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_USER = { email: 'buyer@codiit.com', password: 'test1234' };
const TEST_USERS = [
  { email: 'buyer@codiit.com', password: 'test1234' },
  { email: 'seller@codiit.com', password: 'test1234' },
];

// ─── 커스텀 메트릭 ──────────────────────────────────────
const refreshSuccess = new Counter('refresh_success');
const refreshFailed = new Counter('refresh_failed');
const refreshDuration = new Trend('refresh_duration', true);

// ─── 시나리오 선택 ──────────────────────────────────────
// k6 run --env SCENARIO=same_user   → 시나리오 A만
// k6 run --env SCENARIO=multi_user  → 시나리오 B만
// k6 run                            → 전체 실행
const selectedScenario = __ENV.SCENARIO || 'all';

function buildScenarios() {
  const scenarioA = {
    concurrent_same_user: {
      executor: 'ramping-vus',
      exec: 'sameUserRefresh',
      stages: [
        { duration: '10s', target: 5 },
        { duration: '30s', target: 5 },
        { duration: '10s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '10s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
    },
  };

  const scenarioB = {
    individual_users: {
      executor: 'ramping-vus',
      exec: 'multiUserRefresh',
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '10s', target: 30 },
        { duration: '30s', target: 30 },
        { duration: '10s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
    },
  };

  if (selectedScenario === 'same_user') return scenarioA;
  if (selectedScenario === 'multi_user') return scenarioB;
  return { ...scenarioA, ...scenarioB };
}

// ─── k6 옵션 ────────────────────────────────────────────
export const options = {
  scenarios: buildScenarios(),
  thresholds: {
    // 경고용 임계값 (abortOnFail: false → 테스트는 계속 진행)
    http_req_duration: [{ threshold: 'p(95)<5000', abortOnFail: false }],
  },
};

// ─── setup: 로그인하여 refreshToken 획득 ────────────────
export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(TEST_USER),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const loginOk = check(loginRes, {
    'setup: 로그인 성공 (201)': (r) => r.status === 201,
  });

  if (!loginOk) {
    console.error(`setup 로그인 실패: status=${loginRes.status}, body=${loginRes.body}`);
    return { refreshToken: null };
  }

  // Set-Cookie 헤더에서 refreshToken 추출
  const cookies = loginRes.cookies;
  const refreshToken = cookies.refreshToken ? cookies.refreshToken[0].value : null;

  if (!refreshToken) {
    console.error('setup: refreshToken 쿠키를 찾을 수 없습니다.');
    return { refreshToken: null };
  }

  console.log(`setup 완료: refreshToken 획득 (길이: ${refreshToken.length})`);
  return { refreshToken };
}

// ─── 시나리오 A: 동일 유저 동시 refresh ─────────────────
// 모든 VU가 setup에서 획득한 동일한 refreshToken으로 동시에 refresh 호출.
// 첫 번째 요청만 성공하고, 나머지는 advisory lock 대기 후 401 실패.
// → advisory lock이 커넥션을 점유하는 시간과 병목 정도를 관찰.
export function sameUserRefresh(data) {
  if (!data.refreshToken) {
    console.error('refreshToken 없음 — setup 실패');
    refreshFailed.add(1);
    sleep(1);
    return;
  }

  const res = http.post(`${BASE_URL}/api/auth/refresh`, null, {
    headers: { Cookie: `refreshToken=${data.refreshToken}` },
    tags: { scenario: 'same_user' },
  });

  refreshDuration.add(res.timings.duration);

  const success = check(res, {
    'refresh 성공 (200)': (r) => r.status === 200,
  });

  if (success) {
    refreshSuccess.add(1);
  } else {
    refreshFailed.add(1);
  }

  sleep(0.5);
}

// ─── 시나리오 B: 다수 유저 개별 refresh ─────────────────
// 각 VU가 매 iteration마다 로그인 → 자기만의 refreshToken 획득 → 즉시 refresh.
// advisory lock은 userId별 독립이지만, 모든 트랜잭션이 커넥션 풀을 공유하므로 경합 발생.
// → 커넥션 풀 고갈 시점과 에러율을 관찰.
export function multiUserRefresh() {
  // VU ID로 유저를 번갈아 선택
  const user = TEST_USERS[__VU % TEST_USERS.length];

  // 1. 로그인
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(user),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { scenario: 'multi_user', step: 'login' },
    },
  );

  const loginOk = check(loginRes, {
    'multi: 로그인 성공 (201)': (r) => r.status === 201,
  });

  if (!loginOk) {
    refreshFailed.add(1);
    sleep(1);
    return;
  }

  // 2. 쿠키에서 refreshToken 추출
  const cookies = loginRes.cookies;
  const refreshToken = cookies.refreshToken ? cookies.refreshToken[0].value : null;

  if (!refreshToken) {
    refreshFailed.add(1);
    sleep(1);
    return;
  }

  // 3. 즉시 refresh 호출
  const refreshRes = http.post(`${BASE_URL}/api/auth/refresh`, null, {
    headers: { Cookie: `refreshToken=${refreshToken}` },
    tags: { scenario: 'multi_user', step: 'refresh' },
  });

  refreshDuration.add(refreshRes.timings.duration);

  const success = check(refreshRes, {
    'multi: refresh 성공 (200)': (r) => r.status === 200,
  });

  if (success) {
    refreshSuccess.add(1);
  } else {
    refreshFailed.add(1);
  }

  sleep(1);
}
