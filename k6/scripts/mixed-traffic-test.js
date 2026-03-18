import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// ─── 설정 ───────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PHASE = __ENV.PHASE || 'mixed'; // 'baseline' | 'mixed'
const LABEL = __ENV.LABEL || 'before'; // 'before' | 'after_redis'
const BUYER = { email: 'buyer@codiit.com', password: 'test1234' };

// ─── 일반 API 커스텀 메트릭 (핵심 비교 지표) ──────────────
const normalApiDuration = new Trend('normal_api_duration', true);
const productListDuration = new Trend('product_list_duration', true);
const productDetailDuration = new Trend('product_detail_duration', true);
const userMeDuration = new Trend('user_me_duration', true);
const cartDuration = new Trend('cart_duration', true);
const ordersDuration = new Trend('orders_duration', true);
const notificationsDuration = new Trend('notifications_duration', true);
const metadataGradeDuration = new Trend('metadata_grade_duration', true);
const normalApiErrors = new Counter('normal_api_errors');
const normalApiSuccessRate = new Rate('normal_api_success_rate');

// ─── Refresh 커스텀 메트릭 ─────────────────────────────────
const refreshDuration = new Trend('refresh_duration', true);
const refreshSuccess = new Counter('refresh_success');
const refreshFailed = new Counter('refresh_failed');
const refreshSuccessRate = new Rate('refresh_success_rate');

// ─── 엔드포인트 가중치 (실제 트래픽 패턴 반영) ──────────────
const ENDPOINTS = [
  { name: 'product_list', weight: 30, path: '/api/products', auth: false, metric: productListDuration },
  { name: 'product_detail', weight: 20, path: '/api/products/:id', auth: false, metric: productDetailDuration },
  { name: 'metadata_grade', weight: 10, path: '/api/metadata/grade', auth: false, metric: metadataGradeDuration },
  { name: 'user_me', weight: 15, path: '/api/users/me', auth: true, metric: userMeDuration },
  { name: 'cart', weight: 10, path: '/api/cart', auth: true, metric: cartDuration },
  { name: 'orders', weight: 10, path: '/api/orders?status=WaitingPayment', auth: true, metric: ordersDuration },
  { name: 'notifications', weight: 5, path: '/api/notifications', auth: true, metric: notificationsDuration },
];

// 가중치 합계 (한 번만 계산)
const TOTAL_WEIGHT = ENDPOINTS.reduce((sum, e) => sum + e.weight, 0);

// ─── 가중치 기반 랜덤 엔드포인트 선택 ──────────────────────
function pickEndpoint() {
  let random = Math.random() * TOTAL_WEIGHT;
  for (const ep of ENDPOINTS) {
    random -= ep.weight;
    if (random <= 0) return ep;
  }
  return ENDPOINTS[0];
}

// ─── 시나리오 구성 ────────────────────────────────────────
function buildScenarios() {
  // 일반 트래픽 — baseline과 mixed 모두에서 실행
  const normalTraffic = {
    normal_traffic: {
      executor: 'ramping-vus',
      exec: 'normalTrafficVU',
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '10s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '10s', target: 35 },
        { duration: '30s', target: 35 },
        { duration: '10s', target: 0 },
      ],
      tags: { traffic_type: 'normal', phase: PHASE, label: LABEL },
    },
  };

  // Refresh 트래픽 — mixed 모드에서만 추가
  const refreshTraffic = {
    refresh_traffic: {
      executor: 'ramping-vus',
      exec: 'refreshTrafficVU',
      stages: [
        { duration: '10s', target: 5 },
        { duration: '30s', target: 5 },
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '10s', target: 15 },
        { duration: '30s', target: 15 },
        { duration: '10s', target: 0 },
      ],
      tags: { traffic_type: 'refresh', phase: PHASE, label: LABEL },
    },
  };

  if (PHASE === 'baseline') return normalTraffic;
  return { ...normalTraffic, ...refreshTraffic };
}

// ─── k6 옵션 ────────────────────────────────────────────
export const options = {
  scenarios: buildScenarios(),
  thresholds: {
    // 일반 API 응답 시간 — 핵심 비교 지표
    normal_api_duration: [
      { threshold: 'p(95)<500', abortOnFail: false },
      { threshold: 'p(99)<1000', abortOnFail: false },
    ],
    // 엔드포인트별 응답 시간
    product_list_duration: [{ threshold: 'p(95)<500', abortOnFail: false }],
    product_detail_duration: [{ threshold: 'p(95)<500', abortOnFail: false }],
    user_me_duration: [{ threshold: 'p(95)<500', abortOnFail: false }],
    cart_duration: [{ threshold: 'p(95)<500', abortOnFail: false }],
    orders_duration: [{ threshold: 'p(95)<500', abortOnFail: false }],
    // Refresh 지표
    refresh_duration: [{ threshold: 'p(95)<3000', abortOnFail: false }],
    // 성공률
    normal_api_success_rate: [{ threshold: 'rate>0.95', abortOnFail: false }],
    // 전체 HTTP 응답 시간
    http_req_duration: [{ threshold: 'p(95)<5000', abortOnFail: false }],
  },
};

// ─── setup: 로그인 + 상품 ID 확보 ────────────────────────
export function setup() {
  console.log(`\n📋 테스트 설정: PHASE=${PHASE}, LABEL=${LABEL}`);

  // 1. 로그인 — accessToken + refreshToken 획득
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(BUYER),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const loginOk = check(loginRes, {
    'setup: 로그인 성공 (201)': (r) => r.status === 201,
  });

  if (!loginOk) {
    console.error(`setup 로그인 실패: status=${loginRes.status}, body=${loginRes.body}`);
    return { accessToken: null, refreshToken: null, productIds: [] };
  }

  const body = JSON.parse(loginRes.body);
  const accessToken = body.accessToken;

  // Set-Cookie에서 refreshToken 추출
  const cookies = loginRes.cookies;
  const refreshToken = cookies.refreshToken ? cookies.refreshToken[0].value : null;

  // 2. 상품 목록 조회 — productId 목록 확보 (상세 조회용)
  const productsRes = http.get(`${BASE_URL}/api/products`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

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

// ─── 시나리오: 일반 트래픽 ────────────────────────────────
// 가중치 기반으로 랜덤 엔드포인트를 호출하여 실제 서비스 트래픽을 시뮬레이션.
// refresh 트래픽이 커넥션 풀을 점유할 때 일반 API 응답 시간이 얼마나 느려지는지 측정.
export function normalTrafficVU(data) {
  if (!data.accessToken) {
    console.error('accessToken 없음 — setup 실패');
    normalApiErrors.add(1);
    normalApiSuccessRate.add(false);
    sleep(1);
    return;
  }

  const endpoint = pickEndpoint();

  // 경로에 :id가 포함된 경우 실제 productId로 치환
  let url = `${BASE_URL}${endpoint.path}`;
  if (endpoint.path.includes(':id') && data.productIds.length > 0) {
    const productId = data.productIds[Math.floor(Math.random() * data.productIds.length)];
    url = url.replace(':id', productId);
  } else if (endpoint.path.includes(':id')) {
    // productId가 없으면 product_list로 대체
    url = `${BASE_URL}/api/products`;
  }

  // 헤더 구성
  const headers = {};
  if (endpoint.auth) {
    headers['Authorization'] = `Bearer ${data.accessToken}`;
  }

  const res = http.get(url, {
    headers,
    tags: { endpoint: endpoint.name, traffic_type: 'normal' },
  });

  // 메트릭 기록
  normalApiDuration.add(res.timings.duration);
  endpoint.metric.add(res.timings.duration);

  const success = res.status >= 200 && res.status < 400;
  normalApiSuccessRate.add(success);
  if (!success) {
    normalApiErrors.add(1);
  }

  // 0.5~1.5초 랜덤 think time (실제 유저 행동 시뮬레이션)
  sleep(Math.random() + 0.5);
}

// ─── 시나리오: Refresh 트래픽 ─────────────────────────────
// setup()에서 발급받은 동일한 refreshToken으로 모든 VU가 refresh 호출.
// "한 명이 여러 탭에서 동시에 refresh" 시나리오 시뮬레이션.
// 첫 VU가 토큰을 로테이션하면 나머지는 findByToken에서 즉시 401 (fail-fast).
// pg_sleep(15ms)으로 트랜잭션 창을 넓혀, 동시에 트랜잭션에 진입한 VU들이
// advisory lock 대기하며 커넥션을 점유하는 상황을 재현.
export function refreshTrafficVU(data) {
  if (!data.refreshToken) {
    refreshFailed.add(1);
    refreshSuccessRate.add(false);
    sleep(0.5);
    return;
  }

  // setup()의 공유 refreshToken으로 refresh 호출
  const res = http.post(`${BASE_URL}/api/auth/refresh`, null, {
    headers: { Cookie: `refreshToken=${data.refreshToken}` },
    tags: { endpoint: 'refresh', traffic_type: 'refresh' },
  });

  refreshDuration.add(res.timings.duration);

  const success = check(res, {
    'refresh 응답 (200)': (r) => r.status === 200,
  });

  if (success) {
    refreshSuccess.add(1);
    refreshSuccessRate.add(true);
  } else {
    refreshFailed.add(1);
    refreshSuccessRate.add(false);
  }

  sleep(0.5);
}

// ─── 결과 저장 ────────────────────────────────────────────
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: '  ', enableColors: true }),
    [`k6/results/${PHASE}_${LABEL}_summary.json`]: JSON.stringify(data, null, 2),
  };
}
