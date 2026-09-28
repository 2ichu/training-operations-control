import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AuditContext } from './audit-context.js';

// 로그인한 사용자의 요청 처리 전체를 USER 행위자 컨텍스트 안에서 실행한다.
// 가드(SessionAuthGuard)가 먼저 실행되어 request.authSession 이 채워진 요청에만 적용되며, 세션이 없으면 컨텍스트를 만들지 않는다.
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  constructor(@Inject(AuditContext) private readonly context: AuditContext) {}

  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = execution.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = request.authSession;
    if (!session) return next.handle();
    const actor = { actorType: 'USER' as const, actorUserId: session.userId, ip: request.ip ?? null };
    return new Observable((subscriber) =>
      this.context.run(actor, () => {
        const inner = next.handle().subscribe(subscriber);
        return () => inner.unsubscribe();
      }),
    );
  }
}
