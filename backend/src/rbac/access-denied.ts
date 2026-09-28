import { Logger } from '@nestjs/common';
import type { AuditLogService } from '../audit/audit-log.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

const logger = new Logger('AccessDenied');

// ACCESS_DENIED 감사 기록 (baseline 7절 #4, V3). 대상 리소스는 라우트 패턴(실제 ID 미포함)으로 남기고 사유 코드를 reason 에 둔다.
// 감사 기록이 실패해도 거부 결과 자체는 바뀌지 않는다(거부가 안전한 방향이므로 실패를 로그로만 남긴다).
export async function recordAccessDenied(
  audit: Pick<AuditLogService, 'record'>,
  request: AuthenticatedRequest,
  userId: number,
  reason: string,
): Promise<void> {
  const route = (request.route as { path?: string } | undefined)?.path ?? request.path;
  try {
    await audit.record({
      actorType: 'USER',
      actorUserId: userId,
      action: 'ACCESS_DENIED',
      targetTable: `${request.method} ${route}`.slice(0, 100),
      reason: reason.slice(0, 500),
      ip: request.ip ?? null,
    });
  } catch (error) {
    logger.error(`ACCESS_DENIED 감사 기록 실패: ${(error as Error).message}`);
  }
}
