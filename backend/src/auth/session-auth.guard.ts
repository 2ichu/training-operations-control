import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import authConfig from './auth.config.js';
import { type AuthenticatedRequest, parseCookie } from './auth.types.js';
import { SessionService } from './session.service.js';

// 로그인(세션) 여부만 확인한다. 역할·화면·스코프 권한(RBAC, baseline V1~V10)은 별도 가드에서 구현한다.
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = parseCookie(request.headers.cookie, this.config.cookieName);
    const session = this.sessions.resolve(sessionId);
    if (!session || !sessionId) throw new UnauthorizedException('로그인이 필요합니다.');
    request.authSession = session;
    request.authSessionId = sessionId;
    return true;
  }
}
