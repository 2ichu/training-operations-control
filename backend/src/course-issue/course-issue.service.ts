import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { pageOf, toApi, Where } from '../common/api.js';
import { conflict, lockRow } from '../common/tx.js';
import { asObject, type Obj, oneOf, optInt, optIntArray, qEnumList, qInt, reqInt, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';
import { ACTIVE_STATUSES } from '../verification/verification.constants.js';

const CATEGORIES = ['FACILITY', 'COMPLAINT', 'SAFETY', 'OTHER'] as const;
const STATUSES = ['REGISTERED', 'IN_REVIEW', 'RESOLVED'] as const;

// S18 특이사항(baseline 3-8·5-2, escalate 는 7-347행 API·H6 규칙).
@Injectable()
export class CourseIssueService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  // 조회 스코프는 다른 화면과 다르다: INSTRUCTOR 는 "본인 등록 건"(reported_by=본인)만 본다(baseline 4-2, 배정 과정 기준이 아님).
  async list(request: RbacRequest, query: Obj) {
    const access = request.access!;
    const where = new Where();
    if (access.scope !== 'ALL') where.add((p) => `ci.reported_by = ${p}`, access.userId);
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `ci.course_id = ${p}`, courseId);
    const roundNo = qInt(query, 'round_no');
    if (roundNo) where.add((p) => `s.round_no = ${p}`, roundNo);
    const statuses = qEnumList(query, 'status', STATUSES);
    if (statuses) where.add((p) => `ci.status = ANY(${p}::course_issue_status[])`, statuses);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT ci.issue_id, ci.course_id, ci.schedule_id, s.round_no, ci.category, ci.content, ci.status, ci.reported_by, u.name AS reported_by_name, ci.reported_at,
              count(*) OVER() AS total
         FROM course_issue ci LEFT JOIN class_schedule s ON s.schedule_id = ci.schedule_id JOIN user_account u ON u.user_id = ci.reported_by
        WHERE ${where.sql} ORDER BY ci.reported_at DESC, ci.issue_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }

  async create(request: RbacRequest, body: unknown) {
    const o = asObject(body);
    const courseId = reqInt(o, 'course_id');
    await this.scope.requireCourse(request, courseId); // INSTRUCTOR: 본인 배정 과정만(OPS 는 ALL)
    const scheduleId = optInt(o, 'schedule_id') ?? null;
    const category = oneOf(o.category, 'category', CATEGORIES);
    const content = reqStr(o, 'content', 4000);

    return this.transactions.run(async (tx) => {
      if (scheduleId !== null) {
        const schedule = await tx.query(`SELECT course_id FROM class_schedule WHERE schedule_id = $1`, [scheduleId]);
        if (schedule.rows.length === 0 || Number(schedule.rows[0].course_id) !== courseId) {
          throw new BadRequestException({ code: 'VALIDATION', field: 'schedule_id', message: '해당 과정의 회차가 아닙니다' });
        }
      }
      const created = await tx.create('course_issue', {
        course_id: courseId,
        schedule_id: scheduleId,
        category,
        content,
        status: 'REGISTERED',
        reported_by: tx.actor.actorUserId,
        reported_at: new Date().toISOString(),
      });
      return toApi(created);
    });
  }

  async update(issueId: number, body: unknown) {
    const o = asObject(body);
    const set: Row = {};
    if (o.category !== undefined) set.category = oneOf(o.category, 'category', CATEGORIES);
    if (o.content !== undefined) set.content = reqStr(o, 'content', 4000);
    if (o.schedule_id !== undefined) set.schedule_id = optInt(o, 'schedule_id');
    if (Object.keys(set).length === 0) throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });

    return this.transactions.run(async (tx) => {
      await lockRow(tx, 'course_issue', 'issue_id', issueId);
      return toApi(await tx.update('course_issue', { issue_id: issueId }, set));
    });
  }

  async resolve(issueId: number) {
    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'course_issue', 'issue_id', issueId);
      if (current.status === 'RESOLVED') throw conflict('INVALID_STATE_TRANSITION', '이미 조치완료된 특이사항입니다.');
      return toApi(await tx.update('course_issue', { issue_id: issueId }, { status: 'RESOLVED' }));
    });
  }

  // "확인 필요로 전환"(baseline 7-347행): verification_case(MANUAL) 생성 + course_issue.status=IN_REVIEW(H6).
  // 이미 활성 건이 연결돼 있으면 409(자동 규칙의 근거 병합과 달리, 사람이 누른 액션이므로 조용히 합치지 않고 알려준다).
  async escalate(issueId: number, body: unknown) {
    const traineeIds = optIntArray(asObject(body), 'trainee_ids') ?? [];

    return this.transactions.run(async (tx) => {
      const issue = await lockRow(tx, 'course_issue', 'issue_id', issueId);
      const active = await tx.query(
        `SELECT 1 FROM verification_case WHERE related_course_issue_id = $1 AND status = ANY($2::verification_case_status[])`,
        [issueId, ACTIVE_STATUSES],
      );
      if (active.rows.length > 0) throw conflict('VERIFICATION_CASE_EXISTS', '이미 확인 필요로 전환된 특이사항입니다.');
      const rule = await tx.query(`SELECT rule_id, initial_status FROM detection_rule WHERE rule_code = 'MANUAL'`);
      if (rule.rows.length === 0) throw new Error('MANUAL 탐지규칙 시드가 없습니다(db:seed 필요).');
      const { rule_id: ruleId, initial_status: initialStatus } = rule.rows[0];

      const created = await tx.create('verification_case', {
        course_id: issue.course_id,
        related_course_issue_id: issueId,
        detection_rule_id: ruleId,
        detected_at: new Date().toISOString(),
        evidence: JSON.stringify({
          dedupe_key: `MANUAL:course_issue:${issueId}`,
          items: [{ id: `course_issue:${issueId}`, issue_id: issueId, category: issue.category, content: issue.content }],
        }),
        status: initialStatus,
      });
      for (const traineeId of traineeIds) {
        await tx.query(`INSERT INTO verification_case_trainee (case_id, trainee_id, created_by) VALUES ($1, $2, $3)`, [created.case_id, traineeId, tx.actor.actorUserId]);
      }
      await tx.update('course_issue', { issue_id: issueId }, { status: 'IN_REVIEW' });
      return toApi(created);
    });
  }
}
