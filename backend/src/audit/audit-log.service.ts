import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../database/database.module.js';

export type AuditActorType = 'USER' | 'SYSTEM_RULE' | 'SYSTEM_BATCH' | 'SYSTEM_API';
export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'VIEW_SENSITIVE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  | 'ACCESS_DENIED';

export interface AuditEntry {
  actorType: AuditActorType;
  actorUserId?: number | null;
  action: AuditAction;
  targetTable: string;
  targetId?: number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

/** 풀 또는 트랜잭션 클라이언트 */
export type AuditDb = Pick<pg.Pool, 'query'>;

// audit_log 기록의 최소 단위. 업무 데이터 변경과 함께 남겨야 하는 감사는 두 번째 인자로 트랜잭션 클라이언트를 넘겨
// 같은 트랜잭션에 포함시킨다(AuditedTransactionService 가 사용). DB 의 CHECK 제약이 잘못된 조합을 최종 방어한다.
@Injectable()
export class AuditLogService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async record(entry: AuditEntry, db: AuditDb = this.pool): Promise<void> {
    await db.query(
      `INSERT INTO audit_log (actor_type, actor_user_id, action, target_table, target_id, before_value, after_value, reason, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.actorType,
        entry.actorUserId ?? null,
        entry.action,
        entry.targetTable,
        entry.targetId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.reason ?? null,
        entry.ip ?? null,
      ],
    );
  }
}
