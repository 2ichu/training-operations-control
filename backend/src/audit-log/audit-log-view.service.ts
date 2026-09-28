import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditContext } from '../audit/audit-context.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { pageOf, toApi, Where } from '../common/api.js';
import { type Obj, qDate, qEnumList, qInt, qStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';

const ACTOR_TYPES = ['USER', 'SYSTEM_RULE', 'SYSTEM_BATCH', 'SYSTEM_API'] as const;
const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'VIEW_SENSITIVE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'ACCESS_DENIED'] as const;
// 조회 범위 상한: 정책(보존기간)이 아니라 대량 조회로 인한 부담을 막는 기술적 안전장치(baseline V9 "최대 범위 제한"의 구체값은 미정 — 결정 필요 시 조정).
const MAX_RANGE_DAYS = 366;

// S27 감사로그 조회(baseline 5-2, V9: SYS_ADMIN·EXECUTIVE만, 기간 필수).
@Injectable()
export class AuditLogViewService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(AuditContext) private readonly context: AuditContext,
  ) {}

  async list(query: Obj) {
    const { from, to } = this.requireRange(query);
    const where = new Where();
    where.add((p) => `action_at >= ${p}::date`, from);
    where.add((p) => `action_at < (${p}::date + 1)`, to);
    const actorType = qEnumList(query, 'actor_type', ACTOR_TYPES);
    if (actorType) where.add((p) => `actor_type = ANY(${p}::audit_actor_type[])`, actorType);
    const actorUserId = qInt(query, 'actor_user_id');
    if (actorUserId) where.add((p) => `actor_user_id = ${p}`, actorUserId);
    const targetTable = qStr(query, 'target_table', 100);
    if (targetTable) where.add((p) => `target_table = ${p}`, targetTable);
    const action = qEnumList(query, 'action', ACTIONS);
    if (action) where.add((p) => `action = ANY(${p}::audit_action[])`, action);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT log_id, actor_type, actor_user_id, action, target_table, target_id, action_at, reason, ip_address,
              count(*) OVER() AS total
         FROM audit_log WHERE ${where.sql} ORDER BY action_at DESC, log_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    // 목록 조회는 특정 행 하나를 겨냥하지 않으므로, 조회 시점 이 조건에서 가장 최근 행을 대표 target_id 로 남긴다
    // (DB 제약상 VIEW_SENSITIVE 는 target_id 가 필수 — 구현상의 기술적 처리이며 정책적 의미는 없다). 조회 조건은 reason 에 남긴다.
    const actor = this.context.require();
    await this.audit.record({
      actorType: 'USER',
      actorUserId: actor.actorUserId,
      action: 'VIEW_SENSITIVE',
      targetTable: 'audit_log',
      targetId: rows.length ? Number(rows[0].log_id) : 0,
      reason: this.describeQuery(query, from, to),
      ip: actor.ip,
    });
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }

  async detail(id: number) {
    const { rows } = await this.db.query(
      `SELECT log_id, actor_type, actor_user_id, action, target_table, target_id, before_value, after_value, action_at, reason, ip_address
         FROM audit_log WHERE log_id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    const actor = this.context.require();
    await this.audit.record({
      actorType: 'USER',
      actorUserId: actor.actorUserId,
      action: 'VIEW_SENSITIVE',
      targetTable: 'audit_log',
      targetId: id,
      ip: actor.ip,
    });
    return toApi(rows[0]);
  }

  private requireRange(query: Obj): { from: string; to: string } {
    const from = qDate(query, 'from');
    const to = qDate(query, 'to');
    if (!from || !to) throw new BadRequestException({ code: 'VALIDATION', message: 'from, to 는 필수입니다(YYYY-MM-DD)' });
    if (to < from) throw new BadRequestException({ code: 'VALIDATION', message: 'to 는 from 보다 빠를 수 없습니다' });
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    if (days > MAX_RANGE_DAYS) throw new BadRequestException({ code: 'RANGE_TOO_WIDE', message: `조회 범위는 최대 ${MAX_RANGE_DAYS}일입니다` });
    return { from, to };
  }

  private describeQuery(query: Obj, from: string, to: string): string {
    const parts = [`from=${from}`, `to=${to}`];
    for (const key of ['actor_type', 'actor_user_id', 'target_table', 'action'] as const) {
      const v = query[key];
      if (typeof v === 'string' && v.length > 0) parts.push(`${key}=${v}`);
    }
    return `조회: ${parts.join(', ')}`.slice(0, 500);
  }
}
