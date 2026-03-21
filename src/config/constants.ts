import { z } from 'zod';
import dotenv from 'dotenv';
import ms, { type StringValue } from 'ms';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string(),

  // Token
  ACCESS_TOKEN_SECRET: z.string(),
  ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'), // jwt.sign()에서 직접 사용
  REFRESH_TOKEN_SECRET: z.string(),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'), // jwt.sign()에서 직접 사용

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3001'),

  // Bcrypt
  BCRYPT_ROUNDS: z.coerce.number().default(10),

  // AWS
  AWS_REGION: z.string(),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  AWS_S3_BUCKET: z.string(),

  // Logging
  SLOW_QUERY_THRESHOLD_MS: z.coerce.number().min(1).default(1000),

  // Rate Limiting
  RATE_LIMIT_WINDOW: z.string().default('15m'),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  RATE_LIMIT_AUTH_LOGIN_WINDOW: z.string().default('15m'),
  RATE_LIMIT_AUTH_LOGIN_MAX: z.coerce.number().default(5),
  RATE_LIMIT_AUTH_REFRESH_WINDOW: z.string().default('1m'),
  RATE_LIMIT_AUTH_REFRESH_MAX: z.coerce.number().default(30),

  // Load Test: AWS 네트워크 지연 시뮬레이션 (ms)
  SIMULATE_LATENCY_MS: z.coerce.number().default(0),

  // Portone
  PORTONE_API_URL: z.string().default('https://api.iamport.kr'),
  PORTONE_API_KEY: z.string(),
  PORTONE_API_SECRET: z.string(),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REFRESH_GRACE_PERIOD_SECONDS: z.coerce.number().default(10),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const missing = parsedEnv.error.issues.map((i) => i.path.join('.')).join(', ');
  console.error(`❌ Missing environment variables: ${missing}`);
  process.exit(1);
}

// ms() 변환 + 검증
const accessTokenExpiresMs = ms(parsedEnv.data.ACCESS_TOKEN_EXPIRES_IN as StringValue);
const refreshTokenExpiresMs = ms(parsedEnv.data.REFRESH_TOKEN_EXPIRES_IN as StringValue);
const rateLimitWindowMs = ms(parsedEnv.data.RATE_LIMIT_WINDOW as StringValue);
const rateLimitAuthLoginWindowMs = ms(parsedEnv.data.RATE_LIMIT_AUTH_LOGIN_WINDOW as StringValue);
const rateLimitAuthRefreshWindowMs = ms(
  parsedEnv.data.RATE_LIMIT_AUTH_REFRESH_WINDOW as StringValue,
);

if (typeof accessTokenExpiresMs !== 'number' || accessTokenExpiresMs <= 0) {
  console.error(`❌ Invalid ACCESS_TOKEN_EXPIRES_IN: ${parsedEnv.data.ACCESS_TOKEN_EXPIRES_IN}`);
  process.exit(1);
}

if (typeof refreshTokenExpiresMs !== 'number' || refreshTokenExpiresMs <= 0) {
  console.error(`❌ Invalid REFRESH_TOKEN_EXPIRES_IN: ${parsedEnv.data.REFRESH_TOKEN_EXPIRES_IN}`);
  process.exit(1);
}

if (typeof rateLimitWindowMs !== 'number' || rateLimitWindowMs <= 0) {
  console.error(`❌ Invalid RATE_LIMIT_WINDOW: ${parsedEnv.data.RATE_LIMIT_WINDOW}`);
  process.exit(1);
}

if (typeof rateLimitAuthLoginWindowMs !== 'number' || rateLimitAuthLoginWindowMs <= 0) {
  console.error(
    `❌ Invalid RATE_LIMIT_AUTH_LOGIN_WINDOW: ${parsedEnv.data.RATE_LIMIT_AUTH_LOGIN_WINDOW}`,
  );
  process.exit(1);
}

if (typeof rateLimitAuthRefreshWindowMs !== 'number' || rateLimitAuthRefreshWindowMs <= 0) {
  console.error(
    `❌ Invalid RATE_LIMIT_AUTH_REFRESH_WINDOW: ${parsedEnv.data.RATE_LIMIT_AUTH_REFRESH_WINDOW}`,
  );
  process.exit(1);
}

// env 하나로 통합 (문자열 원본 + ms 변환값)
export const env = {
  ...parsedEnv.data,
  ACCESS_TOKEN_EXPIRES_MS: accessTokenExpiresMs, //setTimeout, Redis TTL 등에 바로 사용 가능하도록 ms로 바꿈
  REFRESH_TOKEN_EXPIRES_MS: refreshTokenExpiresMs,
  RATE_LIMIT_WINDOW_MS: rateLimitWindowMs,
  RATE_LIMIT_AUTH_LOGIN_WINDOW_MS: rateLimitAuthLoginWindowMs,
  RATE_LIMIT_AUTH_REFRESH_WINDOW_MS: rateLimitAuthRefreshWindowMs,
  RATE_LIMIT_MAX: parsedEnv.data.NODE_ENV === 'test' ? 999999 : parsedEnv.data.RATE_LIMIT_MAX,
  RATE_LIMIT_AUTH_LOGIN_MAX:
    parsedEnv.data.NODE_ENV === 'test' ? 999999 : parsedEnv.data.RATE_LIMIT_AUTH_LOGIN_MAX,
  RATE_LIMIT_AUTH_REFRESH_MAX:
    parsedEnv.data.NODE_ENV === 'test' ? 999999 : parsedEnv.data.RATE_LIMIT_AUTH_REFRESH_MAX,
} as const;
