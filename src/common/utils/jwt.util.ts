import crypto from 'crypto';
import type { UserType } from '@prisma/client';
import jwt, { type SignOptions, type Secret } from 'jsonwebtoken';
import { env } from '@/config/constants.js';

export interface JwtPayload {
  userId: string;
  type: UserType;
  loginAt?: number; // Unix timestamp (ms), refreshToken에만 포함 — Absolute Session 기준
}

export interface AuthUser {
  id: string;
  type: UserType;
}

export const generateAccessToken = (userId: string, type: UserType): string => {
  return jwt.sign(
    { userId, type },
    env.ACCESS_TOKEN_SECRET as Secret,
    { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN } as SignOptions,
  );
};

export const generateRefreshToken = (userId: string, type: UserType, loginAt = Date.now()): string => {
  return jwt.sign(
    { userId, type, loginAt },
    env.REFRESH_TOKEN_SECRET as Secret,
    { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN } as SignOptions,
  );
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.ACCESS_TOKEN_SECRET) as JwtPayload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET) as JwtPayload;
};
