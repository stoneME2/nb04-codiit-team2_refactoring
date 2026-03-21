import { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { UnauthorizedError } from '@/common/utils/errors.js';
import { env } from '@/config/constants.js';

export class AuthController {
  private authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService; //밖에서 만든 service → controller 내부로 주입
  }

  login = async (req: Request, res: Response): Promise<void> => {
    const result = await this.authService.login(req.body);

    const cookieMaxAge = env.REFRESH_TOKEN_EXPIRES_MS;
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', //same-site면 포트번호 일치하지 않아도 가능. strict는 포트 번호까지 일치해야 함
      maxAge: cookieMaxAge,
    });

    res.status(201).json({
      user: result.user,
      accessToken: result.accessToken,
    });
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedError('토큰이 없습니다.');
    }
    const result = await this.authService.refresh(refreshToken);

    // 새 리프레시 토큰을 쿠키에 저장 (덮어쓰기) — 성공마다 TTL 갱신
    const cookieMaxAge = env.REFRESH_TOKEN_EXPIRES_MS;
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: cookieMaxAge,
    });

    // 액세스 토큰만 JSON으로 반환
    res.status(200).json({
      accessToken: result.accessToken,
    });
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    await this.authService.logout(req.user!.id);
    res.clearCookie('refreshToken');
    res.status(200).json({ message: '로그아웃 되었습니다.' });
  };
}
