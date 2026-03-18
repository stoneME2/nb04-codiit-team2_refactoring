import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// ─── 설정 ───────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const LABEL = __ENV.LABEL || 'before';
const BURST_VUS = parseInt(__ENV.BURST_VUS || '10');
const BUYER = { email: 'buyer@codiit.com', password: 'test1234' };

// ─── 커스텀 메트릭 ──────────────────────────────────────
// 일반 API
const normalApiDuration = new Trend('normal_api_duration', true);
const normalApiErrors = new Counter('normal_api_errors');
const normalApiSuccessRate = new Rate('normal_api_success_rate');

// Refresh
const refreshDuration = new Trend('refresh_duration', true);
const refreshSuccess = new Counter('refresh_success');
const refreshFailed = new Counter('refresh_failed');
const refreshSuccessRate = new Rate('refresh_success_rate');

// ─── 시나리오 구성 ────────────────────────────────────────
// 1. normal_traffic: 백그라운드 일반 트래픽 (60초간 일정 부하)
// 2. refresh_burst: 10초 후 모든 VU가 동시에 동일 토큰으로 refresh 1회 발사
//    → advisory lock 대기로 커넥션 풀 점유 → 일반 API 응답 시간 변화 관찰
export const options = {
  scenarios: {
    normal_traffic: {
      executor: 'constant-vus',
      exec: 'normalTrafficVU',
      vus: 20,
      duration: '60s',
      tags: { traffic_type: 'normal' },
    },
    refresh_burst: {
      executor: 'per-vu-iterations',
      exec: 'refreshBurstVU',
      vus: BURST_VUS,
      iterations: 1,
      startTime: '10s', // 일반 트래픽이 안정된 후 burst 발사
      maxDuration: '30s',
      tags: { traffic_type: 'refresh' },
    },
  },
  thresholds: {
    normal_api_duration: [{ threshold: 'p(95)<500', abortOnFail: false }],
    refresh_duration: [{ threshold: 'p(95)<5000', abortOnFail: false }],
    normal_api_success_rate: [{ threshold: 'rate>0.95', abortOnFail: false }],
  },
};

// ─── setup: 로그인 + 상품 ID 확보 ────────────────────────
export function setup() {
  console.log(`\n📋 테스트 설정: BURST_VUS=${BURST_VUS}, LABEL=${LABEL}`);

  // 로그인 → accessToken + refreshToken 획득
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(BUYER),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const loginOk = check(loginRes, {
    'setup: 로그인 성공 (201)': (r) => r.status === 201,
  });

  if (!loginOk) {
    console.error(`setup 로그인 실패: status=${loginRes.status}`);
    return { accessToken: null, refreshToken: null, productIds: [] };
  }

  const body = JSON.parse(loginRes.body);
  const accessToken = body.accessToken;
  const cookies = loginRes.cookies;
  const refreshToken = cookies.refreshToken ? cookies.refreshToken[0].value : null;

  // 상품 ID 확보
  const productsRes = http.get(`${BASE_URL}/api/products`);
  let productIds = [];
  if (productsRes.status === 200) {
    try {
      const prodBody = JSON.parse(productsRes.body);
      const items = prodBody.list || prodBody.items || prodBody.data || prodBody;
      if (Array.isArray(items)) {
        productIds = items.slice(0, 5).map((p) => p.id);
      }
    } catch (e) {
      console.warn('setup: 상품 목록 파싱 실패');
    }
  }

  console.log(
    `setup 완료: accessToken=${accessToken ? '✅' : '❌'}, ` +
      `refreshToken=${refreshToken ? '✅' : '❌'}, ` +
      `상품 ${productIds.length}개`,
  );

  return { accessToken, refreshToken, productIds };
}

// ─── 일반 트래픽 (백그라운드) ──────────────────────────────
// 60초간 일정하게 상품 조회를 반복.
// refresh burst 전/중/후의 응답 시간 변화를 관찰하기 위한 기준선.
export function normalTrafficVU(data) {
  if (!data.accessToken) {
    normalApiErrors.add(1);
    normalApiSuccessRate.add(false);
    sleep(1);
    return;
  }

  // 가중치 없이 단순 상품 조회 (가장 빈번한 요청)
  let url;
  if (data.productIds.length > 0 && Math.random() > 0.5) {
    const productId = data.productIds[Math.floor(Math.random() * data.productIds.length)];
    url = `${BASE_URL}/api/products/${productId}`;
  } else {
    url = `${BASE_URL}/api/products`;
  }

  const res = http.get(url, {
    tags: { endpoint: 'products', traffic_type: 'normal' },
  });

  normalApiDuration.add(res.timings.duration);

  const success = res.status >= 200 && res.status < 400;
  normalApiSuccessRate.add(success);
  if (!success) {
    normalApiErrors.add(1);
  }

  sleep(0.3); // 짧은 간격으로 빈번하게 요청
}

// ─── Refresh Burst (동시 발사) ────────────────────────────
// 모든 VU가 동시에 동일 refreshToken으로 refresh를 1회 호출.
// per-vu-iterations + iterations:1 → 모든 VU가 거의 동시에 시작.
//
// 기대 동작:
//   - 모든 VU가 findByToken() 통과 (아직 COMMIT 전)
//   - 모든 VU가 rotateRefreshToken() 트랜잭션 진입
//   - advisory lock으로 직렬화 → 대기 중 커넥션 점유
//   - SIMULATE_LATENCY_MS=15 → 트랜잭션당 ~15ms 추가 지연
//   - VU N번째 대기시간 ≈ N × 15ms
//   - 커넥션 풀 5개 전부 점유 → 일반 API 응답 지연
export function refreshBurstVU(data) {
  if (!data.refreshToken) {
    console.error('refreshToken 없음 — setup 실패');
    refreshFailed.add(1);
    refreshSuccessRate.add(false);
    return;
  }

  const res = http.post(`${BASE_URL}/api/auth/refresh`, null, {
    headers: { Cookie: `refreshToken=${data.refreshToken}` },
    tags: { endpoint: 'refresh', traffic_type: 'refresh' },
  });

  refreshDuration.add(res.timings.duration);

  const success = check(res, {
    'refresh 성공 (200)': (r) => r.status === 200,
  });

  if (success) {
    refreshSuccess.add(1);
    refreshSuccessRate.add(true);
    console.log(`✅ VU ${__VU}: refresh 성공 (${res.timings.duration.toFixed(1)}ms)`);
  } else {
    refreshFailed.add(1);
    refreshSuccessRate.add(false);
    console.log(`❌ VU ${__VU}: refresh 실패 - ${res.status} (${res.timings.duration.toFixed(1)}ms)`);
  }
}

// ─── 결과 저장 ────────────────────────────────────────────
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
    [`k6/results/burst_${BURST_VUS}vu_${LABEL}_summary.json`]: JSON.stringify(data, null, 2),
  };
}
