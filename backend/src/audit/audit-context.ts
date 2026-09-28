import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { AuditActorType } from './audit-log.service.js';

export type AuditErrorCode = 'ACTOR_REQUIRED' | 'INVALID' | 'NOT_FOUND';

export class AuditedTxError extends Error {
  constructor(
    public readonly code: AuditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuditedTxError';
  }
}

export interface ActorContext {
  actorType: AuditActorType;
  /** actorType=USER 일 때만 값이 있고 시스템 행위자는 null */
  actorUserId: number | null;
  ip: string | null;
  /** 시스템 행위자의 규칙·배치 식별자(예: 'RULE_04', 'batch:course-auto-start'). audit_log.reason 에 기록된다 */
  systemTag?: string;
}

// 행위자 컨텍스트 자동 태깅 (baseline 9.2):
//  - 로그인 사용자의 요청 → USER (AuditContextInterceptor 가 설정)
//  - 배치 잡 → SYSTEM_BATCH, 탐지 엔진 → SYSTEM_RULE, 외부 연동 수신 → SYSTEM_API (runAsSystem)
// 컨텍스트가 없는 상태에서의 감사 대상 변경은 거부한다(fail closed).
@Injectable()
export class AuditContext {
  private readonly storage = new AsyncLocalStorage<ActorContext>();

  run<T>(actor: ActorContext, fn: () => T): T {
    this.validate(actor);
    return this.storage.run(actor, fn);
  }

  runAsSystem<T>(actorType: Exclude<AuditActorType, 'USER'>, systemTag: string, fn: () => T): T {
    return this.run({ actorType, actorUserId: null, ip: null, systemTag }, fn);
  }

  current(): ActorContext | undefined {
    return this.storage.getStore();
  }

  require(): ActorContext {
    const actor = this.current();
    if (!actor) throw new AuditedTxError('ACTOR_REQUIRED', '행위자 컨텍스트가 없습니다(요청 인증 또는 runAsSystem 필요)');
    return actor;
  }

  private validate(actor: ActorContext): void {
    if (actor.actorType === 'USER') {
      if (actor.actorUserId === null || !Number.isInteger(actor.actorUserId)) throw new AuditedTxError('INVALID', 'USER 행위자에는 actorUserId 가 필요합니다');
    } else {
      if (actor.actorUserId !== null) throw new AuditedTxError('INVALID', '시스템 행위자에는 actorUserId 를 지정할 수 없습니다');
      if (!actor.systemTag?.trim()) throw new AuditedTxError('INVALID', '시스템 행위자에는 규칙·배치 식별자(systemTag)가 필요합니다');
    }
  }
}
