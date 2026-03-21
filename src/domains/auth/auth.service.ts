import crypto from 'crypto';
import bcrypt from 'bcrypt';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '@/common/utils/jwt.util.js';
import { UnauthorizedError } from '@/common/utils/errors.js';
import { loginSchema } from './auth.schema.js';
import { UserRepository } from '@/domains/user/user.repository.js';
import { AuthRepository } from './auth.repository.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class AuthService {
  constructor(
    private userRepository: UserRepository,
    private authRepository: AuthRepository,
  ) {}

  async login(dto: unknown) {
    const { email, password } = loginSchema.parse(dto);

    const user = await this.userRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedError('이메일 또는 비밀번호가 일치하지 않습니다.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedError('이메일 또는 비밀번호가 일치하지 않습니다.');
    }

    const accessToken = generateAccessToken(user.id, user.type);
    const refreshToken = generateRefreshToken(user.id, user.type);
    const hashedToken = hashToken(refreshToken);

    await this.authRepository.setToken(user.id, hashedToken);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        type: user.type,
        points: user.point,
        image: user.image,
        grade: {
          id: user.grade.id,
          name: user.grade.name,
          rate: user.grade.rate * 100,
          minAmount: user.grade.minAmount,
        },
      },
    };
  }

  async refresh(refreshToken: string) {
    // 1. JWT 서명 검증 — 위조/만료 토큰은 여기서 차단, userId 추출
    let payload: ReturnType<typeof verifyRefreshToken>;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch (err) {
      throw err;
    }
    const { userId } = payload;

    const requestHash = hashToken(refreshToken);

    // 2. Grace Period 확인 — 동시 요청 빠른 처리 경로
    const grace = await this.authRepository.getGraceToken(userId);
    if (grace && grace.oldHash === requestHash) {
      return { accessToken: grace.accessToken, refreshToken: grace.refreshToken };
    }

    // 3. 현재 유효 토큰 해시 조회
    const storedHash = await this.authRepository.getToken(userId);
    if (!storedHash) {
      throw new UnauthorizedError('유효하지 않은 토큰입니다.');
    }

    // 4. 해시 비교 — 불일치 시 grace 재확인 후 공격 여부 판단
    if (storedHash !== requestHash) {
      // Lua 원자 스크립트로 newHash + grace가 동시에 저장되므로:
      // getToken이 newHash를 반환했다면 grace도 반드시 존재함
      // → grace.oldHash === requestHash이면 race condition(정상), 아니면 진짜 재사용 공격
      const raceGrace = await this.authRepository.getGraceToken(userId);
      if (raceGrace && raceGrace.oldHash === requestHash) {
        return { accessToken: raceGrace.accessToken, refreshToken: raceGrace.refreshToken };
      }
      await this.authRepository.deleteToken(userId);

      throw new UnauthorizedError('유효하지 않은 토큰입니다.');
    }

    // 5. 유저 정보 조회
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UnauthorizedError('사용자를 찾을 수 없습니다.');
    }

    // 6. 새 토큰 발급
    const newAccessToken = generateAccessToken(user.id, user.type);
    const newRefreshToken = generateRefreshToken(user.id, user.type);
    const newHashedToken = hashToken(newRefreshToken);

    // 7. Lua CAS + Grace 원자적 저장
    //    CAS 성공 시 새 해시와 grace를 동시에 저장 → race condition 제거
    const rotated = await this.authRepository.rotateTokenWithGrace(
      user.id,
      requestHash,
      newHashedToken,
      {
        oldHash: requestHash,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      },
    );

    if (!rotated) {
      // 다른 동시 요청이 먼저 CAS 성공 → grace는 이미 원자적으로 저장됨
      const retryGrace = await this.authRepository.getGraceToken(userId);
      if (retryGrace && retryGrace.oldHash === requestHash) {
        return { accessToken: retryGrace.accessToken, refreshToken: retryGrace.refreshToken };
      }
      throw new UnauthorizedError('유효하지 않은 토큰입니다.');
    }

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(userId: string) {
    await Promise.all([
      this.authRepository.deleteToken(userId),
      this.authRepository.deleteGraceToken(userId),
    ]);

    return { message: '로그아웃 되었습니다.' };
  }
}
