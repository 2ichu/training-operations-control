import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { maskBirthDate, maskTail } from '../audit/audit-registry.js';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { escapeLike, pageOf, toApi, Where } from '../common/api.js';
import { assertCourseOpen, conflict, lockRow } from '../common/tx.js';
import {
  asObject, type Obj, optDate, optInt, optIso, optStr, qDate, qEnumList, qInt, qStr, reqDate, reqInt, reqStr,
} from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { AccessContext, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';
import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';

const ENROLLMENT_STATUSES = ['APPLIED', 'REVIEWING', 'CONFIRMED', 'COMPLETED', 'DROPPED', 'EXPELLED', 'CANCELLED'] as const;
const ENTITY_TYPES = ['TRAINEE', 'ENROLLMENT'] as const;
// D-05 §6(2026-09-28 확정): 자동 수료 후보 판정 상수. 정책값이며 코드 상수 변경 시에도 이 결정을 그대로 따른다.
const ATTENDANCE_THRESHOLD = 0.8;
const LATE_WEIGHT = 0.5;
// 강사(OWN_ASSIGNED)가 볼 수 없는 등록 상태 = 대상자 확인(S02) 단계 + 취소 (ScopeService.canAccessTrainee 와 동일)
const HIDDEN_FOR_SCOPED = `('APPLIED', 'REVIEWING', 'CANCELLED')`;

// 훈련생 응답: 연락처·생년월일은 마스킹(원문 열람은 S04 수정 화면 전용 — 미구현, 결정 필요)
const presentTrainee = (row: Row) => toApi({ ...row, contact: maskTail(row.contact), birth_date: maskBirthDate(row.birth_date) });

@Injectable()
export class TraineeService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  // ── S02 대상자 확인 ─────────────────────────────────────────────────────
  async listEnrollments(query: Obj) {
    const where = new Where();
    const statuses = qEnumList(query, 'status', ENROLLMENT_STATUSES);
    if (statuses) where.add((p) => `te.status = ANY(${p}::enrollment_status[])`, statuses);
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `te.course_id = ${p}`, courseId);
    const name = qStr(query, 'name');
    if (name) where.add((p) => `t.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(name)}%`);
    const from = qDate(query, 'applied_from');
    if (from) where.add((p) => `te.applied_at >= ${p}::date`, from);
    const to = qDate(query, 'applied_to');
    if (to) where.add((p) => `te.applied_at < (${p}::date + 1)`, to);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT te.enrollment_id, te.trainee_id, t.name, t.birth_date, te.course_id, c.course_name, te.status, te.applied_at, te.confirmed_at, te.cancel_reason,
              count(*) OVER() AS total
         FROM trainee_enrollment te JOIN trainee t ON t.trainee_id = te.trainee_id JOIN course c ON c.course_id = te.course_id
        WHERE ${where.sql} ORDER BY te.applied_at DESC, te.enrollment_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    // 생년월일은 S02 표 컬럼(system-design 7-A)이지만 목록 응답도 연도만 남긴다(baseline 10-1 마스킹)
    return { items: rows.map(({ total: _t, ...r }) => toApi({ ...r, birth_date: maskBirthDate(r.birth_date) })), page: page.page, size: page.size, total };
  }

  async startReview(request: RbacRequest, id: number, body: unknown) {
    await this.requireEnrollmentScope(request, id);
    return this.transitionEnrollment(id, ['APPLIED'], 'REVIEWING', this.optionalReason(body, '대상자 확인 착수'));
  }

  async confirm(request: RbacRequest, id: number, body: unknown) {
    await this.requireEnrollmentScope(request, id);
    return this.transitionEnrollment(id, ['REVIEWING'], 'CONFIRMED', this.optionalReason(body, '대상자 확정'));
  }

  async reject(request: RbacRequest, id: number, body: unknown) {
    await this.requireEnrollmentScope(request, id);
    const cancelReason = reqStr(asObject(body), 'cancel_reason', 500); // V6
    return this.transitionEnrollment(id, ['APPLIED', 'REVIEWING'], 'CANCELLED', cancelReason, { cancel_reason: cancelReason });
  }

  // P1-04(2026-09-22 확정): 수료·중도포기·제적은 출석률 등 자동 판정 기준을 두지 않고, 확정(CONFIRMED) 상태에서
  // OPS_MANAGER 재량으로 사유와 함께 수동 전환한다(자동 판정 기준은 출결 데이터가 생기는 Phase 2 이후 별도 결정).
  async complete(request: RbacRequest, id: number, body: unknown) {
    return this.finalizeEnrollment(request, id, 'COMPLETED', body);
  }

  async drop(request: RbacRequest, id: number, body: unknown) {
    return this.finalizeEnrollment(request, id, 'DROPPED', body);
  }

  async expel(request: RbacRequest, id: number, body: unknown) {
    return this.finalizeEnrollment(request, id, 'EXPELLED', body);
  }

  private async finalizeEnrollment(request: RbacRequest, id: number, to: 'COMPLETED' | 'DROPPED' | 'EXPELLED', body: unknown) {
    await this.requireEnrollmentScope(request, id);
    const reason = reqStr(asObject(body), 'reason', 500); // V6, 최종 전이이므로 사유 필수
    return this.transitionEnrollment(id, ['CONFIRMED'], to, reason);
  }

  // 등록 건 ID 요청: 소속 과정의 스코프를 확인한다(V2). 등록 건이 없으면 이후 트랜잭션에서 404.
  private async requireEnrollmentScope(request: RbacRequest, enrollmentId: number): Promise<void> {
    const { rows } = await this.db.query(`SELECT course_id FROM trainee_enrollment WHERE enrollment_id = $1`, [enrollmentId]);
    if (rows.length > 0) await this.scope.requireCourse(request, Number(rows[0].course_id));
  }

  // D-05 §6(2026-09-28 확정): 자동 판정은 "확인 필요" 후보 표시까지만 하고, 최종 확정은 항상 사람이
  // complete/drop/expel 로 실행한다(verification_case 없이 조회 전용으로 구현, Phase 3 선행 불필요).
  // 가중 출석률 = (PRESENT + LATE×0.5 + EXCUSED) / 적용 가능 회차(휴강 제외). 임계값 80% 미달만 후보로 표시.
  // 판정 시점 = 과정의 마지막 회차(휴강 제외) 종료 후(course.status 와 무관).
  async completionCandidates(request: RbacRequest, courseId: number) {
    await this.scope.requireCourse(request, courseId);
    if ((await this.db.query(`SELECT 1 FROM course WHERE course_id = $1`, [courseId])).rows.length === 0) {
      throw new NotFoundException('대상을 찾을 수 없습니다.');
    }
    const lastRound = await this.db.query(
      `SELECT max((class_date + end_time) AT TIME ZONE $2) AS last_end FROM class_schedule WHERE course_id = $1 AND status <> 'CANCELLED'`,
      [courseId, SCHEDULE_TIMEZONE],
    );
    const lastEnd = lastRound.rows[0]?.last_end as string | null;
    if (!lastEnd || new Date(lastEnd) > new Date()) {
      return { ready: false, threshold: ATTENDANCE_THRESHOLD, lateWeight: LATE_WEIGHT, items: [] };
    }

    const { rows } = await this.db.query(
      `SELECT te.trainee_id, te.enrollment_id, t.name,
              count(s.schedule_id) AS applicable_count,
              count(*) FILTER (WHERE a.attendance_status = 'PRESENT') AS present_count,
              count(*) FILTER (WHERE a.attendance_status = 'LATE') AS late_count,
              count(*) FILTER (WHERE a.attendance_status = 'EXCUSED') AS excused_count
         FROM trainee_enrollment te
         JOIN trainee t ON t.trainee_id = te.trainee_id
         JOIN class_schedule s ON s.course_id = te.course_id AND s.status <> 'CANCELLED'
         LEFT JOIN attendance a ON a.trainee_id = te.trainee_id AND a.schedule_id = s.schedule_id
        WHERE te.course_id = $1 AND te.status = 'CONFIRMED'
        GROUP BY te.trainee_id, te.enrollment_id, t.name`,
      [courseId],
    );
    const items = rows
      .map((r) => {
        const applicable = Number(r.applicable_count);
        const weighted = Number(r.present_count) + Number(r.late_count) * LATE_WEIGHT + Number(r.excused_count);
        const attendanceRate = applicable > 0 ? weighted / applicable : null;
        return { traineeId: Number(r.trainee_id), enrollmentId: Number(r.enrollment_id), name: r.name as string, attendanceRate };
      })
      .filter((r) => r.attendanceRate !== null && r.attendanceRate < ATTENDANCE_THRESHOLD);
    return { ready: true, threshold: ATTENDANCE_THRESHOLD, lateWeight: LATE_WEIGHT, items };
  }

  // baseline 5-2 는 확인 착수·확정에 사유 입력을 정의하지 않지만 전용 변경이력은 사유가 필수다.
  // 그래서 선택 입력(reason)을 받고, 없으면 액션명을 사유로 남긴다(사유 정책 확정 시 재검토).
  private optionalReason(body: unknown, fallback: string): string {
    if (body === undefined || body === null) return fallback;
    return optStr(asObject(body), 'reason', 500) ?? fallback;
  }

  private transitionEnrollment(id: number, from: string[], to: string, reason: string, extra: Row = {}) {
    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'trainee_enrollment', 'enrollment_id', id);
      if (!from.includes(current.status as string)) {
        throw conflict('INVALID_STATE_TRANSITION', `${current.status as string} 상태의 등록 건은 ${to} 로 전환할 수 없습니다.`);
      }
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(current.course_id)));
      const set: Row = { status: to, ...extra };
      if (to === 'CONFIRMED') Object.assign(set, { confirmed_at: new Date(), confirmed_by: tx.actor.actorUserId });
      return toApi(await tx.update('trainee_enrollment', { enrollment_id: id }, set, { reason }));
    });
  }

  // ── S04 등록 ────────────────────────────────────────────────────────────
  async search(query: Obj) {
    const name = qStr(query, 'name');
    if (!name) throw new BadRequestException({ code: 'VALIDATION', field: 'name', message: 'name 은 필수입니다' });
    const birth = qDate(query, 'birth_date');
    const params: unknown[] = [name.trim()];
    let extra = '';
    if (birth) {
      params.push(birth);
      extra = 'AND t.birth_date = $2';
    }
    const { rows } = await this.db.query(
      `SELECT t.trainee_id, t.name, t.birth_date, t.contact, t.registered_at,
              (SELECT count(*) FROM trainee_enrollment te WHERE te.trainee_id = t.trainee_id) AS enrollment_count
         FROM trainee t WHERE t.name = $1 ${extra} ORDER BY t.trainee_id LIMIT 50`,
      params,
    );
    return { items: rows.map(presentTrainee) };
  }

  async createEnrollment(request: RbacRequest, body: unknown) {
    const o = asObject(body);
    const courseId = reqInt(o, 'course_id');
    await this.scope.requireCourse(request, courseId);
    const traineeId = optInt(o, 'trainee_id') ?? undefined;
    const person = o.trainee === undefined ? undefined : asObject(o.trainee, 'trainee');
    if ((traineeId === undefined) === (person === undefined)) {
      throw new BadRequestException({ code: 'VALIDATION', message: 'trainee 또는 trainee_id 중 하나만 지정해야 합니다' });
    }
    const newTrainee = person && {
      name: reqStr(person, 'name', 50),
      birth_date: optDate(person, 'birth_date') ?? null,
      contact: optStr(person, 'contact', 50) ?? null,
    };
    const appliedAt = optIso(o, 'applied_at');

    return this.transactions.run(async (tx) => {
      // #21 임시 기본값: 종료·중단 과정만 거부한다
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', courseId));
      // P1-01: 취소(CANCELLED)된 이전 등록 건은 이력으로 남고, 재신청은 새 등록 건이 된다. 유효한 건이 있을 때만 거부한다.
      let trainee: Row;
      if (newTrainee) {
        trainee = await tx.create('trainee', newTrainee);
      } else {
        trainee = await lockRow(tx, 'trainee', 'trainee_id', traineeId!);
        const dup = await tx.query(`SELECT enrollment_id, status FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2 AND status <> 'CANCELLED'`, [traineeId, courseId]);
        if (dup.rows.length > 0) {
          throw conflict('ENROLLMENT_EXISTS', `이미 해당 과정에 등록된 훈련생입니다(등록 건 ${String(dup.rows[0].enrollment_id)}, 상태 ${String(dup.rows[0].status)}).`);
        }
      }
      const enrollment = await tx.create('trainee_enrollment', {
        trainee_id: trainee.trainee_id,
        course_id: courseId,
        status: 'APPLIED',
        ...(appliedAt ? { applied_at: appliedAt } : {}),
      });
      return { trainee: presentTrainee(trainee), enrollment: toApi(enrollment) };
    });
  }

  async updateTrainee(request: RbacRequest, traineeId: number, body: unknown) {
    await this.scope.requireTrainee(request, traineeId);
    const o = asObject(body);
    const reason = reqStr(o, 'reason', 500); // V6
    const set: Row = {};
    if (o.name !== undefined) set.name = reqStr(o, 'name', 50);
    if (o.birth_date !== undefined) set.birth_date = o.birth_date === null ? null : reqDate(o, 'birth_date');
    if (o.contact !== undefined) set.contact = optStr(o, 'contact', 50);
    if (Object.keys(set).length === 0) throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });
    return this.transactions.run(async (tx) => {
      await lockRow(tx, 'trainee', 'trainee_id', traineeId);
      return presentTrainee(await tx.update('trainee', { trainee_id: traineeId }, set, { reason }));
    });
  }

  // ── S03 훈련생 목록 / S05 상세 (스코프 적용) ─────────────────────────────
  async list(access: AccessContext, query: Obj) {
    const where = new Where();
    where.addFilter((i) => this.scope.traineeScopeFilter(access, 'te.trainee_id', i));
    where.addFilter((i) => this.scope.courseScopeFilter(access, 'te.course_id', i));
    const statuses = qEnumList(query, 'status', ENROLLMENT_STATUSES);
    if (access.scope !== 'ALL') where.clauses.push(`te.status NOT IN ${HIDDEN_FOR_SCOPED}`);
    if (statuses) where.add((p) => `te.status = ANY(${p}::enrollment_status[])`, statuses);
    else if (access.scope === 'ALL') where.clauses.push(`te.status NOT IN ${HIDDEN_FOR_SCOPED}`); // S03 = 확정 훈련생 조회
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `te.course_id = ${p}`, courseId);
    const name = qStr(query, 'name');
    if (name) where.add((p) => `t.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(name)}%`);
    const contact = qStr(query, 'contact', 50);
    if (contact) {
      // 마스킹 표시만 허용하는 화면에서 검색으로 원문을 추측하지 못하도록 4자 이상 필요
      if (contact.length < 4) throw new BadRequestException({ code: 'VALIDATION', field: 'contact', message: 'contact 는 4자 이상이어야 합니다' });
      where.add((p) => `t.contact ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(contact)}%`);
    }

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT te.enrollment_id, te.trainee_id, t.name, t.birth_date, t.contact, te.course_id, c.course_name, te.status, te.confirmed_at,
              count(*) OVER() AS total
         FROM trainee_enrollment te JOIN trainee t ON t.trainee_id = te.trainee_id JOIN course c ON c.course_id = te.course_id
        WHERE ${where.sql} ORDER BY t.name, te.enrollment_id LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => presentTrainee(r)), page: page.page, size: page.size, total };
  }

  async detail(request: RbacRequest, traineeId: number) {
    await this.scope.requireTrainee(request, traineeId);
    const { rows } = await this.db.query(`SELECT trainee_id, name, birth_date, contact, registered_at, created_at, updated_at FROM trainee WHERE trainee_id = $1`, [traineeId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    return { ...presentTrainee(rows[0]), enrollments: await this.enrollmentsOf(request.access!, traineeId) };
  }

  async enrollments(request: RbacRequest, traineeId: number) {
    await this.scope.requireTrainee(request, traineeId);
    return { items: await this.enrollmentsOf(request.access!, traineeId) };
  }

  private async enrollmentsOf(access: AccessContext, traineeId: number) {
    const where = new Where();
    where.add((p) => `te.trainee_id = ${p}`, traineeId);
    where.addFilter((i) => this.scope.courseScopeFilter(access, 'te.course_id', i));
    if (access.scope !== 'ALL') where.clauses.push(`te.status NOT IN ${HIDDEN_FOR_SCOPED}`);
    const { rows } = await this.db.query(
      `SELECT te.enrollment_id, te.course_id, c.course_name, te.status, te.applied_at, te.confirmed_at, te.cancel_reason
         FROM trainee_enrollment te JOIN course c ON c.course_id = te.course_id WHERE ${where.sql} ORDER BY te.applied_at DESC, te.enrollment_id DESC`,
      where.params,
    );
    return rows.map((r) => toApi(r));
  }

  // ── S06 훈련생 변경이력 ──────────────────────────────────────────────────
  async changeLogs(query: Obj) {
    const where = new Where();
    const traineeId = qInt(query, 'trainee_id');
    if (traineeId) where.add((p) => `((l.entity_type = 'TRAINEE' AND l.entity_id = ${p}) OR te.trainee_id = ${p})`, traineeId);
    // 훈련생명 검색(system-design S06 검색조건). 현재 이름 기준이다(이름을 바꾼 경우 이전 이름으로는 찾지 않음).
    const traineeName = qStr(query, 'trainee_name');
    if (traineeName) where.add((p) => `t.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(traineeName)}%`);
    const types = qEnumList(query, 'entity_type', ENTITY_TYPES);
    if (types) where.add((p) => `l.entity_type = ANY(${p}::trainee_change_entity[])`, types);
    const from = qDate(query, 'from');
    if (from) where.add((p) => `l.changed_at >= ${p}::date`, from);
    const to = qDate(query, 'to');
    if (to) where.add((p) => `l.changed_at < (${p}::date + 1)`, to);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT l.log_id, l.entity_type, l.entity_id, l.changed_by, u.name AS changed_by_name, l.changed_at, l.before_value, l.after_value, l.reason,
              t.trainee_id, t.name AS trainee_name, c.course_name,
              count(*) OVER() AS total
         FROM trainee_change_log l
         JOIN user_account u ON u.user_id = l.changed_by
         LEFT JOIN trainee_enrollment te ON l.entity_type = 'ENROLLMENT' AND te.enrollment_id = l.entity_id
         LEFT JOIN course c ON c.course_id = te.course_id
         JOIN trainee t ON t.trainee_id = CASE WHEN l.entity_type = 'TRAINEE' THEN l.entity_id ELSE te.trainee_id END
        WHERE ${where.sql} ORDER BY l.changed_at DESC, l.log_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }
}
