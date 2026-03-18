import prisma from '@/config/prisma.js';
import { queryStats } from '@/common/utils/queryStats.js';
import { env } from '@/config/constants.js';

export interface CreateRefreshTokenData {
  token: string; // 해시된 토큰
  jti: string;
  userId: string;
  expiresAt: Date;
}

export class AuthRepository {
  // 토큰 저장
  async createRefreshToken(data: CreateRefreshTokenData) {
    return prisma.refreshToken.create({
      data,
    });
  }

  // 토큰 조회 (해시값으로)
  async findByToken(hashedToken: string) {
    return prisma.refreshToken.findUnique({
      where: { token: hashedToken },
    });
  }

  // 토큰 삭제 (단일) - 로그아웃 시 사용
  async deleteByToken(hashedToken: string) {
    return prisma.refreshToken.deleteMany({
      where: { token: hashedToken },
    });
  }

  // 사용자의 모든 토큰 삭제 - 비밀번호 변경 시 사용
  async deleteAllByUserId(userId: string) {
    return prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  // 만료된 토큰 정리 (배치 작업용)
  async deleteExpiredTokens() {
    const result = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }

  async rotateRefreshToken(userId: string, data: CreateRefreshTokenData) {
    queryStats.recordRotation();
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Advisory Lock: 동일 userId의 요청 직렬화
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

        // AWS 네트워크 지연 시뮬레이션 (부하테스트 전용, 기본값 0 = 비활성)
        if (env.SIMULATE_LATENCY_MS > 0) {
          await tx.$executeRaw`SELECT pg_sleep(${env.SIMULATE_LATENCY_MS / 1000})`;
        }

        // 2. 기존 토큰 전체 삭제 (사용자당 1개 토큰만 유지)
        await tx.refreshToken.deleteMany({
          where: { userId },
        });

        // 3. 새 토큰 생성
        return tx.refreshToken.create({
          data,
        });
      });
      queryStats.recordRotationSuccess();
      return result;
    } catch (error) {
      queryStats.recordRotationFailure();
      throw error;
    }
  }
}
