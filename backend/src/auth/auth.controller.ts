import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Response } from 'express';
import authConfig from './auth.config.js';
import { AuthService } from './auth.service.js';
import { type AuthenticatedRequest, parseCookie } from './auth.types.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { loginId, password } = this.parseLoginBody(body);
    const previousSessionId = parseCookie(request.headers.cookie, this.config.cookieName);
    const { sessionId, user } = await this.auth.login(loginId, password, request.ip ?? null, previousSessionId);
    // 세션 쿠키: JS 접근 불가, 교차 사이트 POST 에 미전송(Lax), 만료는 서버가 강제한다
    response.cookie(this.config.cookieName, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      path: '/',
    });
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.authSession!, request.authSessionId!, request.ip ?? null);
    response.clearCookie(this.config.cookieName, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.auth.me(request.authSession!, request.authSessionId!);
  }

  // 본인 비밀번호 변경(강제 변경 포함, baseline 10-2 #5). 화면 권한이 아니라 로그인 여부만 확인한다(logout·me 와 동일).
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(SessionAuthGuard)
  async changePassword(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const { currentPassword, newPassword } = this.parseChangePasswordBody(body);
    await this.auth.changePassword(request.authSession!, currentPassword, newPassword);
    return { ok: true };
  }

  private parseLoginBody(body: unknown): { loginId: string; password: string } {
    const { loginId, password } = (body ?? {}) as Record<string, unknown>;
    if (typeof loginId !== 'string' || typeof password !== 'string') throw new BadRequestException('loginId 와 password 는 문자열이어야 합니다.');
    if (loginId.length < 1 || loginId.length > 50) throw new BadRequestException('loginId 길이가 올바르지 않습니다.');
    if (password.length < 1 || password.length > 200) throw new BadRequestException('password 길이가 올바르지 않습니다.');
    return { loginId, password };
  }

  private parseChangePasswordBody(body: unknown): { currentPassword: string; newPassword: string } {
    const { currentPassword, newPassword } = (body ?? {}) as Record<string, unknown>;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      throw new BadRequestException('currentPassword 와 newPassword 는 문자열이어야 합니다.');
    }
    return { currentPassword, newPassword };
  }
}
