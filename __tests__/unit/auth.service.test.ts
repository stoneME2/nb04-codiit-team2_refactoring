import crypto from 'crypto';
import { jest, beforeEach, afterEach, describe, it, expect } from '@jest/globals';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { createUserWithGradeMock } from '../mocks/user.mock.js';
import { createLoginInputMock } from '../mocks/auth.mock.js';
import { UnauthorizedError } from '@/common/utils/errors.js';
import type { UserRepository } from '@/domains/user/user.repository.js';
import type { AuthRepository } from '@/domains/auth/auth.repository.js';

// JWT util mock
const mockGenerateAccessToken = jest.fn().mockReturnValue('mock-access-token');
const mockGenerateRefreshToken = jest.fn().mockReturnValue('mock-refresh-token');
const mockVerifyRefreshToken = jest.fn();

jest.unstable_mockModule('@/common/utils/jwt.util.js', () => ({
  generateAccessToken: mockGenerateAccessToken,
  generateRefreshToken: mockGenerateRefreshToken,
  verifyRefreshToken: mockVerifyRefreshToken,
}));

// bcrypt mock
const mockCompare = jest.fn<(data: string, encrypted: string) => Promise<boolean>>();
jest.unstable_mockModule('bcrypt', () => ({
  default: {
    compare: mockCompare,
  },
}));

// 동적 import (mock 설정 후)
const { AuthService } = await import('@/domains/auth/auth.service.js');

// refresh 테스트에 사용할 고정 토큰 및 해시
const MOCK_REFRESH_TOKEN = 'mock-refresh-token';
const MOCK_HASHED_TOKEN = crypto.createHash('sha256').update(MOCK_REFRESH_TOKEN).digest('hex');

describe('AuthService 유닛 테스트', () => {
  let authService: InstanceType<typeof AuthService>;
  let userRepository: DeepMockProxy<UserRepository>;
  let authRepository: DeepMockProxy<AuthRepository>;

  const userId = 'user-id-1';

  beforeEach(() => {
    userRepository = mockDeep<UserRepository>();
    authRepository = mockDeep<AuthRepository>();
    authService = new AuthService(userRepository, authRepository);

    // 기본 mock 설정
    mockCompare.mockResolvedValue(true);
    mockGenerateAccessToken.mockReturnValue('mock-access-token');
    mockGenerateRefreshToken.mockReturnValue(MOCK_REFRESH_TOKEN);
    mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });

    // AuthRepository Redis 기본 mock — grace 미스, 정상 토큰, CAS 성공 기본값
    authRepository.getGraceToken.mockResolvedValue(null);
    authRepository.getToken.mockResolvedValue(MOCK_HASHED_TOKEN);
    authRepository.setToken.mockResolvedValue(undefined);
    authRepository.rotateTokenWithGrace.mockResolvedValue(true);
    authRepository.setGraceToken.mockResolvedValue(undefined);
    authRepository.deleteToken.mockResolvedValue(undefined);
    authRepository.deleteGraceToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // 로그인
  describe('login', () => {
    it('로그인 성공', async () => {
      const inputData = createLoginInputMock();
      const user = createUserWithGradeMock({ email: inputData.email });

      userRepository.findByEmail.mockResolvedValue(user);

      const result = await authService.login(inputData);

      expect(userRepository.findByEmail).toHaveBeenCalledWith(inputData.email);
      expect(mockCompare).toHaveBeenCalledWith(inputData.password, user.password);
      expect(mockGenerateAccessToken).toHaveBeenCalledWith(user.id, user.type);
      expect(mockGenerateRefreshToken).toHaveBeenCalledWith(user.id, user.type);
      expect(authRepository.setToken).toHaveBeenCalledWith(user.id, expect.any(String));
      expect(result.accessToken).toBe('mock-access-token');
      expect(result.refreshToken).toBe(MOCK_REFRESH_TOKEN);
      expect(result.user.email).toBe(inputData.email);
    });

    it('존재하지 않는 이메일인 경우 UnauthorizedError 발생', async () => {
      const inputData = createLoginInputMock({ email: 'notfound@example.com' });

      userRepository.findByEmail.mockResolvedValue(null);

      await expect(authService.login(inputData)).rejects.toThrow(UnauthorizedError);
      expect(mockCompare).not.toHaveBeenCalled();
      expect(mockGenerateAccessToken).not.toHaveBeenCalled();
    });

    it('비밀번호가 틀린 경우 UnauthorizedError 발생', async () => {
      const inputData = createLoginInputMock({ password: 'wrongpassword' });
      const user = createUserWithGradeMock({ email: inputData.email });

      userRepository.findByEmail.mockResolvedValue(user);
      mockCompare.mockResolvedValue(false);

      await expect(authService.login(inputData)).rejects.toThrow(UnauthorizedError);
      expect(mockGenerateAccessToken).not.toHaveBeenCalled();
    });
  });

  // 토큰 갱신
  describe('refresh', () => {
    it('토큰 갱신 성공 — grace 미스, CAS 성공 경로', async () => {
      const user = createUserWithGradeMock({ id: userId });
      mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });
      userRepository.findById.mockResolvedValue(user);

      const result = await authService.refresh(MOCK_REFRESH_TOKEN);

      expect(authRepository.getGraceToken).toHaveBeenCalledWith(userId);
      expect(authRepository.getToken).toHaveBeenCalledWith(userId);
      expect(authRepository.rotateTokenWithGrace).toHaveBeenCalledWith(
        userId,
        MOCK_HASHED_TOKEN,
        expect.any(String),
        expect.objectContaining({ oldHash: MOCK_HASHED_TOKEN }),
      );
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('토큰 갱신 성공 — grace 히트 경로 (동시 요청 처리)', async () => {
      mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });
      authRepository.getGraceToken.mockResolvedValue({
        oldHash: MOCK_HASHED_TOKEN,
        accessToken: 'cached-access-token',
        refreshToken: 'cached-refresh-token',
      });

      const result = await authService.refresh(MOCK_REFRESH_TOKEN);

      // grace 히트 시 Redis 캐시에서 즉시 반환, CAS 없이 처리
      expect(userRepository.findById).not.toHaveBeenCalled();
      expect(authRepository.rotateTokenWithGrace).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('cached-access-token');
      expect(result.refreshToken).toBe('cached-refresh-token');
    });

    it('Redis에 토큰이 없으면 UnauthorizedError 발생', async () => {
      mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });
      authRepository.getToken.mockResolvedValue(null);

      await expect(authService.refresh(MOCK_REFRESH_TOKEN)).rejects.toThrow(UnauthorizedError);
      expect(userRepository.findById).not.toHaveBeenCalled();
    });

    it('토큰 해시 불일치 시 UnauthorizedError 발생 (재사용 감지)', async () => {
      mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });
      authRepository.getToken.mockResolvedValue('different-hash');
      // grace도 없음 → 진짜 재사용 공격
      authRepository.getGraceToken.mockResolvedValue(null);

      await expect(authService.refresh(MOCK_REFRESH_TOKEN)).rejects.toThrow(UnauthorizedError);
      expect(authRepository.deleteToken).toHaveBeenCalledWith(userId);
    });

    it('해시 불일치 후 grace 재확인 성공 — 동시 요청 race condition 케이스', async () => {
      mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });
      // getToken이 이미 rotation된 새 해시를 반환 (다른 요청이 먼저 rotation 완료)
      authRepository.getToken.mockResolvedValue('already-rotated-hash');
      // grace에는 현재 요청의 oldHash가 저장되어 있음 (Lua 원자 저장)
      authRepository.getGraceToken
        .mockResolvedValueOnce(null) // 첫 번째 getGraceToken (step 2): race 전에 확인 → null
        .mockResolvedValueOnce({
          // 두 번째 getGraceToken (step 4 retry): rotation 후 확인 → 히트
          oldHash: MOCK_HASHED_TOKEN,
          accessToken: 'race-winner-access-token',
          refreshToken: 'race-winner-refresh-token',
        });

      const result = await authService.refresh(MOCK_REFRESH_TOKEN);

      expect(result.accessToken).toBe('race-winner-access-token');
      expect(authRepository.deleteToken).not.toHaveBeenCalled();
    });

    it('유효하지 않은 JWT 서명이면 에러 발생', async () => {
      mockVerifyRefreshToken.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(authService.refresh('invalid-token')).rejects.toThrow();
      expect(authRepository.getGraceToken).not.toHaveBeenCalled();
    });

    it('사용자가 존재하지 않으면 UnauthorizedError 발생', async () => {
      mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });
      userRepository.findById.mockResolvedValue(null);

      await expect(authService.refresh(MOCK_REFRESH_TOKEN)).rejects.toThrow(UnauthorizedError);
      expect(authRepository.rotateTokenWithGrace).not.toHaveBeenCalled();
    });

    it('CAS 실패 후 grace 재확인 성공 — 동시 요청 경합 패배 케이스', async () => {
      const user = createUserWithGradeMock({ id: userId });
      mockVerifyRefreshToken.mockReturnValue({ userId, type: 'BUYER' });
      userRepository.findById.mockResolvedValue(user);
      // CAS 실패 (다른 요청이 먼저 성공 — grace는 이미 원자적으로 저장됨)
      authRepository.rotateTokenWithGrace.mockResolvedValue(false);
      // 재확인 시 grace에 새 토큰이 있음
      authRepository.getGraceToken
        .mockResolvedValueOnce(null) // 첫 번째 호출: grace 미스
        .mockResolvedValueOnce({
          // 두 번째 호출 (CAS 실패 후 재확인): grace 히트
          oldHash: MOCK_HASHED_TOKEN,
          accessToken: 'winner-access-token',
          refreshToken: 'winner-refresh-token',
        });

      const result = await authService.refresh(MOCK_REFRESH_TOKEN);

      expect(result.accessToken).toBe('winner-access-token');
    });
  });

  // 로그아웃
  describe('logout', () => {
    it('로그아웃 성공', async () => {
      const result = await authService.logout(userId);

      // refresh 키 + grace 키 둘 다 삭제
      expect(authRepository.deleteToken).toHaveBeenCalledWith(userId);
      expect(authRepository.deleteGraceToken).toHaveBeenCalledWith(userId);
      expect(result.message).toBe('로그아웃 되었습니다.');
    });
  });
});
