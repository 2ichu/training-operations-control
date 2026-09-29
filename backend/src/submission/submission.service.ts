import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { maskTail } from '../audit/audit-registry.js';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { lockRow } from '../common/tx.js';
import { escapeLike, toApi, Where } from '../common/api.js';
import { asObject, type Obj, oneOf, qEnumList, qInt, qStr, reqInt, reqIso, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';

const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED'] as const;
const REVIEW_RESULTS = ['APPROVED', 'REVISION_REQUESTED', 'REJECTED'] as const;
// D-04 §24(제출기한 저장 위치) 결정 전까지 기한후제출 자동판정은 보류(baseline 2-4) — 항상 SUBMITTED로 생성(D-08 지각판정 보류와 동일한 원칙).
const DEFAULT_SUBMIT_STATUS = 'SUBMITTED';

// S19 결과물 제출현황(+S20 미제출, API 재사용) / S21 결과물 검토 (baseline 3-5·5-2).
@Injectable()
export class SubmissionService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  // ── S19·S20: 제출현황(미제출 계산) ──────────────────────────────────────
  async submissionStatus(request: RbacRequest, courseId: number, query: Obj) {
    await this.scope.requireCourse(request, courseId);
    if ((await this.db.query(`SELECT 1 FROM course WHERE course_id = $1`, [courseId])).rows.length === 0) {
      throw new NotFoundException('대상을 찾을 수 없습니다.');
    }
    const traineeName = qStr(query, 'trainee_name');
    const reviewStatus = qEnumList(query, 'review_status', REVIEW_STATUSES);
    const missingOnly = this.qBool(query, 'missing_only');

    const where = new Where();
    where.add((p) => `te.course_id = ${p}`, courseId);
    where.clauses.push(`te.status = 'CONFIRMED'`);
    if (traineeName) where.add((p) => `t.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(traineeName)}%`);
    if (missingOnly) where.clauses.push(`s.submission_id IS NULL`);
    else if (reviewStatus) where.add((p) => `s.review_status = ANY(${p}::submission_review_status[])`, reviewStatus);

    // 등록일시·등록자(system-design S19 "created_at·created_by"): submission 에는 감사 컬럼이 없어(ERD) 같은 트랜잭션에 남는
    // audit_log 의 CREATE 기록에서 가져온다. 연락처는 S20 표시용(마스킹, 훈련생 목록과 같은 기준)
    const { rows } = await this.db.query(
      `SELECT te.trainee_id, t.name AS trainee_name, t.contact, s.submission_id, s.title, s.version, s.submitted_at, s.submit_status, s.review_status,
              reg.action_at AS registered_at, reg.name AS registered_by_name
         FROM trainee_enrollment te JOIN trainee t ON t.trainee_id = te.trainee_id
         LEFT JOIN submission s ON s.trainee_id = te.trainee_id AND s.course_id = te.course_id
         LEFT JOIN LATERAL (
           SELECT a.action_at, u.name FROM audit_log a LEFT JOIN user_account u ON u.user_id = a.actor_user_id
            WHERE a.target_table = 'submission' AND a.target_id = s.submission_id AND a.action = 'CREATE' ORDER BY a.log_id LIMIT 1
         ) reg ON TRUE
        WHERE ${where.sql} ORDER BY t.name, s.title`,
      where.params,
    );
    return {
      items: rows.map((r) => ({ ...toApi({ ...r, contact: maskTail(r.contact) }), displayStatus: r.submission_id === null ? 'NOT_SUBMITTED' : (r.submit_status as string) })),
    };
  }

  // ── S19: 결과물 등록·재등록 ─────────────────────────────────────────────
  async register(request: RbacRequest, courseId: number, body: unknown) {
    await this.scope.requireCourse(request, courseId);
    const o = asObject(body);
    const traineeId = reqInt(o, 'trainee_id');
    const title = reqStr(o, 'title', 200);
    const submittedAt = reqIso(o, 'submitted_at');

    return this.transactions.run(async (tx) => {
      const eligible = await tx.query(`SELECT 1 FROM trainee_enrollment WHERE course_id = $1 AND trainee_id = $2 AND status = 'CONFIRMED'`, [courseId, traineeId]);
      if (eligible.rows.length === 0) throw new BadRequestException({ code: 'VALIDATION', field: 'trainee_id', message: '확정된 훈련생이 아닙니다' });
      const created = await tx.create('submission', {
        trainee_id: traineeId,
        course_id: courseId,
        title,
        version: 1,
        submitted_at: submittedAt,
        submit_status: DEFAULT_SUBMIT_STATUS,
        review_status: 'PENDING',
      });
      return toApi(created);
    });
  }

  async reRegister(request: RbacRequest, submissionId: number, body: unknown) {
    const o = asObject(body);
    const submittedAt = reqIso(o, 'submitted_at');

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'submission', 'submission_id', submissionId);
      await this.scope.requireCourse(request, Number(current.course_id));
      const updated = await tx.update('submission', { submission_id: submissionId }, {
        version: Number(current.version) + 1,
        submitted_at: submittedAt,
        review_status: 'PENDING',
      });
      return toApi(updated);
    });
  }

  // ── S21: 결과물 상세·검토 ───────────────────────────────────────────────
  async detail(request: RbacRequest, submissionId: number) {
    const submission = await this.findWithScope(request, submissionId);
    const { rows: attachments } = await this.db.query(
      `SELECT attachment_id, entity_version, file_name, file_size, uploaded_at FROM attachment
        WHERE entity_type = 'SUBMISSION' AND entity_id = $1 ORDER BY entity_version, attachment_id`,
      [submissionId],
    );
    const { rows: reviews } = await this.db.query(
      `SELECT l.log_id, l.version, l.reviewer_id, u.name AS reviewer_name, l.reviewed_at, l.review_result, l.review_comment
         FROM submission_review_log l JOIN user_account u ON u.user_id = l.reviewer_id
        WHERE l.submission_id = $1 ORDER BY l.version, l.log_id`,
      [submissionId],
    );
    const { rows: names } = await this.db.query(
      `SELECT t.name AS trainee_name, c.course_name FROM trainee t, course c WHERE t.trainee_id = $1 AND c.course_id = $2`,
      [submission.trainee_id, submission.course_id],
    );
    return { ...toApi(submission), ...toApi(names[0] ?? {}), attachments: attachments.map((r) => toApi(r)), reviews: reviews.map((r) => toApi(r)) };
  }

  async review(request: RbacRequest, submissionId: number, body: unknown) {
    const o = asObject(body);
    const reviewResult = oneOf(o.review_result, 'review_result', REVIEW_RESULTS);
    const reviewComment = o.review_comment === undefined || o.review_comment === null ? null : reqStr(o, 'review_comment', 2000);

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'submission', 'submission_id', submissionId);
      await this.scope.requireCourse(request, Number(current.course_id));
      const log = await tx.create('submission_review_log', {
        submission_id: submissionId,
        version: current.version,
        reviewer_id: tx.actor.actorUserId,
        review_result: reviewResult,
        review_comment: reviewComment,
      });
      const updated = await tx.update('submission', { submission_id: submissionId }, { review_status: reviewResult });
      return { ...toApi(updated), review: toApi(log) };
    });
  }

  // ── S05: 훈련생 상세의 결과물 현황 ──────────────────────────────────────
  async byTrainee(request: RbacRequest, traineeId: number, query: Obj) {
    await this.scope.requireTrainee(request, traineeId);
    const where = new Where();
    where.add((p) => `s.trainee_id = ${p}`, traineeId);
    // 강사는 같은 훈련생이라도 본인 배정 과정의 결과물만 본다(V2·V4)
    where.addFilter((i) => this.scope.courseScopeFilter(request.access!, 's.course_id', i));
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `s.course_id = ${p}`, courseId);
    const { rows } = await this.db.query(
      `SELECT s.submission_id, s.course_id, c.course_name, s.title, s.version, s.submitted_at, s.submit_status, s.review_status
         FROM submission s JOIN course c ON c.course_id = s.course_id WHERE ${where.sql} ORDER BY s.submitted_at DESC`,
      where.params,
    );
    return { items: rows.map((r) => toApi(r)) };
  }

  // ── 내부 헬퍼 ───────────────────────────────────────────────────────────
  private async findWithScope(request: RbacRequest, submissionId: number): Promise<Row> {
    const { rows } = await this.db.query(`SELECT * FROM submission WHERE submission_id = $1`, [submissionId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    await this.scope.requireCourse(request, Number(rows[0].course_id));
    return rows[0];
  }

  private qBool(query: Obj, key: string): boolean {
    return query[key] === 'true' || query[key] === true;
  }
}
