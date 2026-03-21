import type { Redis } from 'ioredis';
import { env } from '@/config/constants.js';

// refresh 키 CAS + grace 키 SET을 단일 원자적 트랜잭션으로 처리
// CAS 성공 시 새 해시와 grace를 동시에 저장 → rotateToken/setGraceToken 사이 race condition 제거
// return 1: 교체 성공, return 0: 불일치 (다른 요청이 이미 교체함)
const ROTATE_AND_GRACE_SCRIPT = `
  local current = redis.call('GET', KEYS[1])
  if current == ARGV[1] then
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
    redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[5])
    return 1
  else
    return 0
  end
`;

export interface GraceTokenData {
  oldHash: string;
  accessToken: string;
  refreshToken: string;
}

export class AuthRepository {
  constructor(private redis: Redis) {}

  // --- refresh:{userId} — 현재 유효 토큰 해시 (7일 TTL) ---

  // 로그인 최초 발급 — 비교 없이 덮어쓰기
  async setToken(userId: string, hashedToken: string): Promise<void> {
    const ttlSeconds = Math.floor(env.REFRESH_TOKEN_EXPIRES_MS / 1000);
    await this.redis.set(`refresh:${userId}`, hashedToken, 'EX', ttlSeconds);
  }

  async getToken(userId: string): Promise<string | null> {
    return this.redis.get(`refresh:${userId}`);
  }

  // refresh rotation + grace 설정을 단일 원자적 연산으로 처리
  // true: CAS 성공 (새 해시 + grace 동시 저장), false: CAS 실패 (다른 요청이 먼저 교체)
  async rotateTokenWithGrace(
    userId: string,
    oldHash: string,
    newHash: string,
    graceData: GraceTokenData,
  ): Promise<boolean> {
    const ttlSeconds = Math.floor(env.REFRESH_TOKEN_EXPIRES_MS / 1000); //ms → seconds 변환
    const result = await this.redis.eval(
      ROTATE_AND_GRACE_SCRIPT,
      2,
      `refresh:${userId}`,
      `grace:${userId}`,
      oldHash,
      newHash,
      String(ttlSeconds),
      JSON.stringify(graceData),
      String(env.REFRESH_GRACE_PERIOD_SECONDS),
    );
    return result === 1;
  }

  async deleteToken(userId: string): Promise<void> {
    await this.redis.del(`refresh:${userId}`);
  }

  // --- grace:{userId} — rotation 직후 10초간 새 토큰 쌍 보관 ---
  // 동시 요청들이 CAS 실패 후 여기서 같은 새 토큰을 받아가도록 한다.

  async setGraceToken(userId: string, data: GraceTokenData): Promise<void> {
    await this.redis.set(
      `grace:${userId}`,
      JSON.stringify(data),
      'EX',
      env.REFRESH_GRACE_PERIOD_SECONDS,
    );
  }

  async getGraceToken(userId: string): Promise<GraceTokenData | null> {
    const raw = await this.redis.get(`grace:${userId}`);
    if (!raw) return null;
    return JSON.parse(raw) as GraceTokenData;
  }

  async deleteGraceToken(userId: string): Promise<void> {
    await this.redis.del(`grace:${userId}`);
  }
}
