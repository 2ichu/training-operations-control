import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { pageOf, toApi, Where } from '../common/api.js';
import { conflict, lockRow } from '../common/tx.js';
import { asObject, type Obj, optStr, qDate, qInt, reqInt, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { AccessContext, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';

// S17 회차별 운영일지(baseline 3-7·5-2). "미작성"은 행이 없는 계산 상태 — RULE_03(회차 운영기록 지연)의 판단 근거가
// 되므로 written_at(작성 시각)을 정확히 저장한다. V7(과정 상태 검증)·V6(사유 필수) 목록에 운영일지는 없어 적용하지 않는다.
@Injectable()
export class OperationLogService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  // ── 회차별 작성 현황 (미작성 계산 포함) ──────────────────────────────────
  async list(request: RbacRequest, courseId: number, query: Obj) {
    await this.scope.requireCourse(request, courseId);
    const access = request.access!;
    const roundNo = qInt(query, 'round_no');
    const from = qDate(query, 'from');
    const to = qDate(query, 'to');

    const where = new Where();
    where.add((p) => `s.course_id = ${p}`, courseId);
    where.addFilter((i) => this.scope.scheduleScopeFilter(access, 's.instructor_id', i));
    if (roundNo) where.add((p) => `s.round_no = ${p}`, roundNo);
    if (from) where.add((p) => `s.class_date >= ${p}`, from);
    if (to) where.add((p) => `s.class_date <= ${p}`, to);

    const { rows } = await this.db.query(
      `SELECT s.schedule_id, s.round_no, s.class_date, s.status AS schedule_status, s.instructor_id,
              o.operation_log_id, o.participant_count, o.written_at,
              CASE WHEN o.operation_log_id IS NOT NULL THEN 'WRITTEN' WHEN s.status = 'CANCELLED' THEN NULL ELSE 'NOT_WRITTEN' END AS display_status
         FROM class_schedule s LEFT JOIN operation_log o ON o.schedule_id = s.schedule_id
        WHERE ${where.sql} ORDER BY s.round_no`,
      where.params,
    );
    return { items: rows.map((r) => toApi(r)) };
  }

  // ── 단일 회차 운영일지 조회/작성/수정 ────────────────────────────────────
  async detail(request: RbacRequest, scheduleId: number) {
    await this.scope.requireSchedule(request, scheduleId);
    const row = await this.findBySchedule(scheduleId);
    if (!row) throw new NotFoundException('대상을 찾을 수 없습니다.'); // 미작성(계산 상태) — 행 없음
    return toApi(row);
  }

  async create(request: RbacRequest, scheduleId: number, body: unknown) {
    await this.scope.requireSchedule(request, scheduleId);
    const o = asObject(body);
    const content = reqStr(o, 'content', 4000);
    const participantCount = reqInt(o, 'participant_count', 0);
    const issueNote = optStr(o, 'issue_note', 2000) ?? null;

    return this.transactions.run(async (tx) => {
      const schedule = await lockRow(tx, 'class_schedule', 'schedule_id', scheduleId);
      if (schedule.status === 'CANCELLED') throw conflict('SCHEDULE_CANCELLED', '휴강 처리된 회차는 운영일지를 작성할 수 없습니다.');
      const created = await tx.create('operation_log', {
        schedule_id: scheduleId,
        instructor_id: schedule.instructor_id,
        content,
        participant_count: participantCount,
        issue_note: issueNote,
        author_id: tx.actor.actorUserId,
        written_at: new Date().toISOString(),
      });
      return toApi(created);
    });
  }

  async update(request: RbacRequest, operationLogId: number, body: unknown) {
    const o = asObject(body);
    const set: Row = {};
    if (o.content !== undefined) set.content = reqStr(o, 'content', 4000);
    if (o.participant_count !== undefined) set.participant_count = reqInt(o, 'participant_count', 0);
    if (o.issue_note !== undefined) set.issue_note = optStr(o, 'issue_note', 2000);
    if (Object.keys(set).length === 0) throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'operation_log', 'operation_log_id', operationLogId);
      await this.scope.requireSchedule(request, Number(current.schedule_id)); // V2: 작성 강사 본인 또는 OPS(ALL)
      return toApi(await tx.update('operation_log', { operation_log_id: operationLogId }, set));
    });
  }

  private async findBySchedule(scheduleId: number): Promise<Row | undefined> {
    const { rows } = await this.db.query(`SELECT * FROM operation_log WHERE schedule_id = $1`, [scheduleId]);
    return rows[0];
  }
}
