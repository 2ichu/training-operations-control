import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditLogService } from '../audit/audit-log.service.js';
import { SessionService } from '../auth/session.service.js';
import { recordAccessDenied } from './access-denied.js';
import { PermissionService } from './permission.service.js';
import { REQUIRE_PERMISSION_KEY, type RbacRequest, type RequiredPermission } from './rbac.types.js';

// 서버 권한 검증(baseline V1·V3). SessionAuthGuard 이후에 실행되며 @Authorize 로 함께 적용된다.
// - 요구 권한이 선언되지 않은 엔드포인트에 붙었다면 설정 오류이므로 거부(fail closed)
// - 계정이 비활성화·삭제되었으면 세션을 종료하고 401
// - 권한이 없으면 403 + ACCESS_DENIED 감사
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RbacRequest>();
    const session = request.authSession;
    if (!session) throw new UnauthorizedException('로그인이 필요합니다.');

    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      this.logger.error(`요구 권한이 선언되지 않은 엔드포인트: ${request.method} ${request.path}`);
      await recordAccessDenied(this.audit, request, session.userId, 'PERMISSION_NOT_DECLARED');
      throw new ForbiddenException('접근 권한이 없습니다.');
    }

    const result = await this.permissions.lookup(session.userId, required.screenId, required.action);
    if (result.status === 'INACTIVE') {
      this.sessions.destroy(request.authSessionId);
      throw new UnauthorizedException('세션이 유효하지 않습니다.');
    }
    if (result.status === 'NO_PERMISSION') {
      await recordAccessDenied(this.audit, request, session.userId, `NO_PERMISSION:${required.screenId}:${required.action}`);
      throw new ForbiddenException('접근 권한이 없습니다.');
    }

    request.access = {
      userId: session.userId,
      roles: result.roles,
      instructorId: result.instructorId,
      screenId: required.screenId,
      action: required.action,
      scope: result.scope,
    };
    return true;
  }
}
