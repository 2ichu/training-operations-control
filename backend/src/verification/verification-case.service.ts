import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { escapeLike, pageOf, toApi, Where } from '../common/api.js';
import { conflict, lockRow } from '../common/tx.js';
import { asObject, type Obj, optStr, qDate, qEnumList, qInt, qStr, reqInt, reqIntArray, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';
import { ACTION_TYPES, CASE_STATUSES } from './verification.constants.js';

type ActionType = (typeof ACTION_TYPES)[number];

// S22 확인 필요 목록 / S23 확인 필요 상세 / S24 조치이력 (baseline 3-4·5-2). 자동 탐지는 DetectionRuleService, 여기는 조회·조치만.
@Injectable()
export class VerificationCaseService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  // ── S22 ─────────────────────────────────────────────────────────────────
  async list(query: Obj) {
    const where = new Where();
    const period = qDate(query, 'period');
    if (period) where.add((p) => `vc.detected_at::date = ${p}`, period);
    // 발생일 범위(system-design 7.2 검색조건 "기간(발생일 범위)"). 날짜 경계는 일정과 같은 APP_TIMEZONE 기준.
    const from = qDate(query, 'from');
    const to = qDate(query, 'to');
    if (from || to) {
      where.addFilter((i) => ({
        sql: `(vc.detected_at AT TIME ZONE $${i})::date BETWEEN coalesce($${i + 1}::date, '-infinity'::date) AND coalesce($${i + 2}::date, 'infinity'::date)`,
        params: [SCHEDULE_TIMEZONE, from ?? null, to ?? null],
      }));
    }
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `vc.course_id = ${p}`, courseId);
    const assigneeId = qInt(query, 'assignee_id');
    if (assigneeId) where.add((p) => `vc.assignee_id = ${p}`, assigneeId);
    const ruleCode = qStr(query, 'rule_code', 20);
    if (ruleCode) where.add((p) => `dr.rule_code = ${p}`, ruleCode);
    const statuses = qEnumList(query, 'status', CASE_STATUSES);
    if (statuses) where.add((p) => `vc.status = ANY(${p}::verification_case_status[])`, statuses);
    const traineeName = qStr(query, 'trainee_name');
    if (traineeName) {
      where.add(
        (p) => `EXISTS (SELECT 1 FROM verification_case_trainee vct JOIN trainee t ON t.trainee_id = vct.trainee_id WHERE vct.case_id = vc.case_id AND t.name ILIKE ${p} ESCAPE '\\')`,
        `%${escapeLike(traineeName)}%`,
      );
    }

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT vc.case_id, vc.course_id, c.course_name, vc.detection_rule_id, dr.rule_code, dr.rule_name, vc.detected_at, vc.status, vc.assignee_id, u.name AS assignee_name, vc.closed_at,
              count(*) OVER() AS total
         FROM verification_case vc
         JOIN detection_rule dr ON dr.rule_id = vc.detection_rule_id
         JOIN course c ON c.course_id = vc.course_id
         LEFT JOIN user_account u ON u.user_id = vc.assignee_id
        WHERE ${where.sql} ORDER BY vc.detected_at DESC, vc.case_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    const trainees = await this.traineesByCase(rows.map((r) => Number(r.case_id)));
    const items = rows.map(({ total: _t, ...r }) => ({ ...toApi(r), priority: r.status === 'PRIORITY_CHECK', trainees: trainees.get(Number(r.case_id)) ?? [] }));
    return { items, page: page.page, size: page.size, total };
  }

  async assign(body: unknown) {
    const o = asObject(body);
    const caseIds = reqIntArray(o, 'case_ids');
    const assigneeId = reqInt(o, 'assignee_id');

    return this.transactions.run(async (tx) => {
      const { rows } = await tx.query(`SELECT case_id FROM verification_case WHERE case_id = ANY($1::bigint[]) FOR UPDATE`, [caseIds]);
      const found = new Set(rows.map((r) => Number(r.case_id)));
      let updated = 0;
      for (const caseId of caseIds) {
        if (!found.has(caseId)) continue;
        await tx.update('verification_case', { case_id: caseId }, { assignee_id: assigneeId });
        updated += 1;
      }
      return { updated, notFound: caseIds.filter((id) => !found.has(id)) };
    });
  }

  // ── S23 ─────────────────────────────────────────────────────────────────
  async detail(caseId: number) {
    const { rows } = await this.db.query(
      `SELECT vc.*, dr.rule_code, dr.rule_name, c.course_name, ua.name AS assignee_name
         FROM verification_case vc JOIN detection_rule dr ON dr.rule_id = vc.detection_rule_id JOIN course c ON c.course_id = vc.course_id
         LEFT JOIN user_account ua ON ua.user_id = vc.assignee_id
        WHERE vc.case_id = $1`,
      [caseId],
    );
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    const row = rows[0];
    const evidence = row.evidence as { dedupe_key: string; items: Row[] };
    const trainees = (await this.traineesByCase([caseId])).get(caseId) ?? [];

    const scheduleIds = [...new Set(evidence.items.map((it) => it.schedule_id).filter((v): v is number => typeof v === 'number'))];
    const schedules = scheduleIds.length
      ? (await this.db.query(`SELECT schedule_id, round_no, class_date FROM class_schedule WHERE schedule_id = ANY($1::bigint[])`, [scheduleIds])).rows.map((r) => toApi(r))
      : [];
    const relatedCourseIssue = row.related_course_issue_id
      ? toApi((await this.db.query(`SELECT issue_id, category, content, status FROM course_issue WHERE issue_id = $1`, [row.related_course_issue_id])).rows[0])
      : null;
    const relatedOperationLog = row.related_operation_log_id
      ? toApi((await this.db.query(`SELECT operation_log_id, schedule_id, content, written_at FROM operation_log WHERE operation_log_id = $1`, [row.related_operation_log_id])).rows[0])
      : null;
    const { rows: actionLogs } = await this.db.query(
      `SELECT l.log_id, l.actor_id, u.name AS actor_name, l.action_at, l.action_type, l.previous_status, l.new_status, l.note
         FROM verification_action_log l JOIN user_account u ON u.user_id = l.actor_id WHERE l.case_id = $1 ORDER BY l.action_at, l.log_id`,
      [caseId],
    );

    return {
      ...toApi({
        case_id: row.case_id, course_id: row.course_id, course_name: row.course_name, detection_rule_id: row.detection_rule_id,
        rule_code: row.rule_code, rule_name: row.rule_name, detected_at: row.detected_at, evidence, status: row.status,
        assignee_id: row.assignee_id, assignee_name: row.assignee_name, confirmation_note: row.confirmation_note, action_note: row.action_note, closed_at: row.closed_at,
      }),
      priority: row.status === 'PRIORITY_CHECK',
      trainees,
      schedules,
      relatedCourseIssue,
      relatedOperationLog,
      actionLogs: actionLogs.map((r) => toApi(r)),
    };
  }

  async startReview(caseId: number, body: unknown) {
    const note = reqStr(asObject(body), 'confirmation_note', 2000);
    return this.doTransition(caseId, ['NEEDS_CHECK', 'PRIORITY_CHECK', 'FOLLOW_UP'], 'IN_REVIEW', 'CHECK', { confirmation_note: note }, note);
  }

  async completeConfirmation(caseId: number, body: unknown) {
    const note = optStr(asObject(body), 'confirmation_note', 2000) ?? null;
    // 메모를 생략하면 확인 시작 때 적은 confirmation_note 를 그대로 둔다(null 로 덮어쓰지 않음)
    return this.doTransition(caseId, ['IN_REVIEW'], 'CONFIRMED', 'CLOSE', { ...(note !== null ? { confirmation_note: note } : {}), closed_at: new Date().toISOString() }, note);
  }

  async requireAction(caseId: number, body: unknown) {
    const note = reqStr(asObject(body), 'action_note', 2000);
    return this.doTransition(caseId, ['IN_REVIEW'], 'ACTION_REQUIRED', 'ACTION_ENTRY', { action_note: note }, note);
  }

  async completeAction(caseId: number, body: unknown) {
    const note = optStr(asObject(body), 'action_note', 2000) ?? null;
    // 메모를 생략하면 조치 필요 때 적은 action_note 를 그대로 둔다
    return this.doTransition(caseId, ['ACTION_REQUIRED'], 'ACTION_DONE', 'CLOSE', { ...(note !== null ? { action_note: note } : {}), closed_at: new Date().toISOString() }, note);
  }

  async reopen(caseId: number, body: unknown) {
    const reason = reqStr(asObject(body), 'reason', 500);
    return this.doTransition(caseId, ['CONFIRMED', 'ACTION_DONE'], 'FOLLOW_UP', 'REOPEN', {}, reason);
  }

  // ── S05: 훈련생 상세의 관련 확인 건(OPS·EXEC·SYS 전용, baseline 5-2) ───────
  async byTrainee(traineeId: number) {
    const { rows } = await this.db.query(
      `SELECT vc.case_id, vc.course_id, c.course_name, dr.rule_code, dr.rule_name, vc.status, vc.detected_at, vc.closed_at
         FROM verification_case_trainee vct
         JOIN verification_case vc ON vc.case_id = vct.case_id
         JOIN course c ON c.course_id = vc.course_id
         JOIN detection_rule dr ON dr.rule_id = vc.detection_rule_id
        WHERE vct.trainee_id = $1 ORDER BY vc.detected_at DESC`,
      [traineeId],
    );
    return { items: rows.map((r) => ({ ...toApi(r), priority: r.status === 'PRIORITY_CHECK' })) };
  }

  // ── S24 ─────────────────────────────────────────────────────────────────
  async actionLogs(query: Obj) {
    const where = new Where();
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `vc.course_id = ${p}`, courseId);
    const assigneeId = qInt(query, 'assignee_id');
    if (assigneeId) where.add((p) => `vc.assignee_id = ${p}`, assigneeId);
    const from = qDate(query, 'from');
    if (from) where.add((p) => `l.action_at >= ${p}::date`, from);
    const to = qDate(query, 'to');
    if (to) where.add((p) => `l.action_at < (${p}::date + 1)`, to);
    const actionType = qEnumList(query, 'action_type', ACTION_TYPES);
    if (actionType) where.add((p) => `l.action_type = ANY(${p}::verification_action_type[])`, actionType);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT l.log_id, l.case_id, vc.course_id, c.course_name, l.actor_id, u.name AS actor_name, l.action_at, l.action_type, l.previous_status, l.new_status, l.note,
              count(*) OVER() AS total
         FROM verification_action_log l
         JOIN verification_case vc ON vc.case_id = l.case_id
         JOIN course c ON c.course_id = vc.course_id
         JOIN user_account u ON u.user_id = l.actor_id
        WHERE ${where.sql} ORDER BY l.action_at DESC, l.log_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }

  // ── 내부 헬퍼 ───────────────────────────────────────────────────────────
  // S01 대시보드도 재사용한다(사건별 관련 훈련생 조인) — S22와 동일한 표시 규칙(system-design 7.1).
  async traineesByCase(caseIds: number[]): Promise<Map<number, Row[]>> {
    if (caseIds.length === 0) return new Map();
    const { rows } = await this.db.query(
      `SELECT vct.case_id, vct.trainee_id, t.name, vct.attendance_id
         FROM verification_case_trainee vct JOIN trainee t ON t.trainee_id = vct.trainee_id
        WHERE vct.case_id = ANY($1::bigint[]) ORDER BY t.name`,
      [caseIds],
    );
    const map = new Map<number, Row[]>();
    for (const r of rows) {
      const key = Number(r.case_id);
      const list = map.get(key) ?? [];
      list.push(toApi({ trainee_id: r.trainee_id, name: r.name, attendance_id: r.attendance_id }));
      map.set(key, list);
    }
    return map;
  }

  // baseline 3-4 상태 전이표: from 에 현재 상태가 없으면 409. action_log 는 같은 트랜잭션에서 함께 기록한다(항상 사람 행위자).
  private async doTransition(caseId: number, from: readonly string[], to: string, actionType: ActionType, set: Row, note: string | null): Promise<Row> {
    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'verification_case', 'case_id', caseId);
      if (!from.includes(current.status as string)) throw conflict('INVALID_STATE_TRANSITION', `현재 상태(${current.status})에서는 처리할 수 없습니다.`);
      const updated = await tx.update('verification_case', { case_id: caseId }, { ...set, status: to });
      await tx.query(
        `INSERT INTO verification_action_log (case_id, actor_id, action_type, previous_status, new_status, note) VALUES ($1, $2, $3, $4, $5, $6)`,
        [caseId, tx.actor.actorUserId, actionType, current.status, to, note],
      );
      return toApi(updated);
    });
  }
}
