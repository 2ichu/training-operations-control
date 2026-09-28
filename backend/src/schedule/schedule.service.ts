import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { pageOf, toApi, Where } from '../common/api.js';
import { assertCourseOpen, conflict, lockRow } from '../common/tx.js';
import { asObject, type Obj, optStr, optTime, qDate, qInt, reqDate, reqInt, reqStr, reqTime } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { AccessContext, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';

// 계산값 "진행완료"(휴강이 아니고 현재 시각이 종료 시각을 지남)의 기준 시간대. 확정 전 임시값(결정 필요).
export const SCHEDULE_TIMEZONE = process.env.APP_TIMEZONE ?? 'Asia/Seoul';

/** 회차 표시 상태(baseline 3-6): 저장값(예정/휴강) + 계산값 "진행완료". tz 는 SCHEDULE_TIMEZONE 을 받는 SQL 플레이스홀더 */
export const scheduleDisplayStatusSql = (tz: string): string =>
  `CASE WHEN s.status = 'CANCELLED' THEN 'CANCELLED' WHEN now() > ((s.class_date + s.end_time) AT TIME ZONE ${tz}) THEN 'COMPLETED' ELSE 'SCHEDULED' END`;

const invalidTimes = () => new BadRequestException({ code: 'INVALID_TIME_RANGE', message: '종료 시각은 시작 시각보다 늦어야 합니다' });

@Injectable()
export class ScheduleService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  // ── S13 일정 목록 ───────────────────────────────────────────────────────
  async list(access: AccessContext, query: Obj) {
    const where = new Where();
    where.addFilter((i) => this.scope.scheduleScopeFilter(access, 's.instructor_id', i));
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `s.course_id = ${p}`, courseId);
    const instructorId = qInt(query, 'instructor_id');
    if (instructorId) where.add((p) => `s.instructor_id = ${p}`, instructorId);
    const from = qDate(query, 'from');
    if (from) where.add((p) => `s.class_date >= ${p}`, from);
    const to = qDate(query, 'to');
    if (to) where.add((p) => `s.class_date <= ${p}`, to);
    where.params.push(SCHEDULE_TIMEZONE);
    const tz = `$${where.params.length}::text`;

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT s.schedule_id, s.course_id, c.course_name, s.round_no, s.class_date, s.start_time, s.end_time, s.instructor_id, i.name AS instructor_name,
              s.content, s.status,
              ${scheduleDisplayStatusSql(tz)} AS display_status,
              count(*) OVER() AS total
         FROM class_schedule s JOIN course c ON c.course_id = s.course_id JOIN instructor i ON i.instructor_id = s.instructor_id
        WHERE ${where.sql} ORDER BY s.class_date, s.start_time, s.schedule_id LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }

  // ── 회차 등록 ───────────────────────────────────────────────────────────
  async create(request: RbacRequest, courseId: number, body: unknown) {
    await this.scope.requireCourse(request, courseId);
    const o = asObject(body);
    const values = {
      course_id: courseId,
      round_no: reqInt(o, 'round_no'),
      class_date: reqDate(o, 'class_date'),
      start_time: reqTime(o, 'start_time'),
      end_time: reqTime(o, 'end_time'),
      instructor_id: reqInt(o, 'instructor_id'),
      content: optStr(o, 'content', 500) ?? null,
    };
    if (values.end_time <= values.start_time) throw invalidTimes();

    return this.transactions.run(async (tx) => {
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', courseId));
      const instructor = await lockRow(tx, 'instructor', 'instructor_id', values.instructor_id);
      if (instructor.status !== 'ACTIVE') throw conflict('INSTRUCTOR_INACTIVE', '활동 중인 강사만 회차에 지정할 수 있습니다.');
      // baseline 5-2 는 "필요 시 instructor_assignment 도 CREATE" 라고만 정의한다. 자동 생성 조건이 미정이므로 생성하지 않고,
      // 유효한 배정(과정 전체 또는 해당 회차)이 없으면 거부한다.
      const assignment = await tx.query(
        `SELECT 1 FROM instructor_assignment WHERE instructor_id = $1 AND course_id = $2 AND status = 'ASSIGNED' AND (round_no IS NULL OR round_no = $3) LIMIT 1`,
        [values.instructor_id, courseId, values.round_no],
      );
      if (assignment.rows.length === 0) throw conflict('ASSIGNMENT_REQUIRED', '해당 과정(또는 회차)에 유효하게 배정된 강사만 지정할 수 있습니다.');
      return toApi(await tx.create('class_schedule', { ...values, status: 'SCHEDULED' }));
    });
  }

  // ── 회차 수정 / 휴강 ────────────────────────────────────────────────────
  async update(request: RbacRequest, scheduleId: number, body: unknown) {
    await this.scope.requireSchedule(request, scheduleId);
    const o = asObject(body);
    const set: Row = {};
    if (o.class_date !== undefined) set.class_date = reqDate(o, 'class_date');
    if (o.start_time !== undefined) set.start_time = optTime(o, 'start_time');
    if (o.end_time !== undefined) set.end_time = optTime(o, 'end_time');
    if (o.content !== undefined) set.content = optStr(o, 'content', 500);
    if (Object.keys(set).length === 0) throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });
    const reason = optStr(o, 'reason', 500) ?? undefined;

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'class_schedule', 'schedule_id', scheduleId);
      if (current.status === 'CANCELLED') throw conflict('SCHEDULE_CANCELLED', '휴강 처리된 회차는 수정할 수 없습니다.');
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(current.course_id)));
      const start = (set.start_time ?? current.start_time) as string;
      const end = (set.end_time ?? current.end_time) as string;
      if (end <= start) throw invalidTimes();
      return toApi(await tx.update('class_schedule', { schedule_id: scheduleId }, set, { reason }));
    });
  }

  async cancelClass(request: RbacRequest, scheduleId: number, body: unknown) {
    await this.scope.requireSchedule(request, scheduleId);
    const reason = reqStr(asObject(body), 'reason', 500); // V6
    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'class_schedule', 'schedule_id', scheduleId);
      if (current.status !== 'SCHEDULED') throw conflict('INVALID_STATE_TRANSITION', `${current.status as string} 상태의 회차는 휴강 처리할 수 없습니다.`);
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(current.course_id)));
      return toApi(await tx.update('class_schedule', { schedule_id: scheduleId }, { status: 'CANCELLED' }, { reason }));
    });
  }

  // P1-06(2026-09-22 확정): 회차의 담당 강사만 교체한다. instructor_assignment 는 자동으로 생성·취소하지 않고
  // (P1-12 와 같은 원칙) 새 강사에게 유효한 배정이 이미 있어야 한다. 배정 자체를 바꾸려면 별도 배정 API를 쓴다.
  async reassignInstructor(request: RbacRequest, scheduleId: number, body: unknown) {
    await this.scope.requireSchedule(request, scheduleId);
    const o = asObject(body);
    const instructorId = reqInt(o, 'instructor_id');
    const reason = reqStr(o, 'reason', 500); // V6

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'class_schedule', 'schedule_id', scheduleId);
      if (current.status === 'CANCELLED') throw conflict('SCHEDULE_CANCELLED', '휴강 처리된 회차는 수정할 수 없습니다.');
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(current.course_id)));
      if (Number(current.instructor_id) === instructorId) throw conflict('SAME_INSTRUCTOR', '현재와 동일한 강사입니다.');
      const instructor = await lockRow(tx, 'instructor', 'instructor_id', instructorId);
      if (instructor.status !== 'ACTIVE') throw conflict('INSTRUCTOR_INACTIVE', '활동 중인 강사만 회차에 지정할 수 있습니다.');
      const assignment = await tx.query(
        `SELECT 1 FROM instructor_assignment WHERE instructor_id = $1 AND course_id = $2 AND status = 'ASSIGNED' AND (round_no IS NULL OR round_no = $3) LIMIT 1`,
        [instructorId, current.course_id, current.round_no],
      );
      if (assignment.rows.length === 0) throw conflict('ASSIGNMENT_REQUIRED', '해당 과정(또는 회차)에 유효하게 배정된 강사만 지정할 수 있습니다.');
      return toApi(await tx.update('class_schedule', { schedule_id: scheduleId }, { instructor_id: instructorId }, { reason }));
    });
  }

  // ── 강사 배정 (S13) ─────────────────────────────────────────────────────
  async assign(request: RbacRequest, courseId: number, body: unknown) {
    await this.scope.requireCourse(request, courseId);
    const o = asObject(body);
    const instructorId = reqInt(o, 'instructor_id');
    const roundNo = o.round_no === undefined || o.round_no === null ? null : reqInt(o, 'round_no');

    return this.transactions.run(async (tx) => {
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', courseId));
      const instructor = await lockRow(tx, 'instructor', 'instructor_id', instructorId);
      if (instructor.status !== 'ACTIVE') throw conflict('INSTRUCTOR_INACTIVE', '활동 중인 강사만 배정할 수 있습니다.');
      // P1-02: 취소된 이전 배정은 이력으로 남고 재배정은 새 행이 된다. 유효한 배정의 (강사, 과정, 회차) 중복과 과정 전체 담당 중복은
      // DB 부분 유니크 인덱스가 최종 방어하며 409 ASSIGNMENT_CONFLICT 로 응답된다
      return toApi(await tx.create('instructor_assignment', { instructor_id: instructorId, course_id: courseId, round_no: roundNo, status: 'ASSIGNED' }));
    });
  }

  async cancelAssignment(request: RbacRequest, assignmentId: number, body: unknown) {
    const reason = reqStr(asObject(body), 'reason', 500); // 전용 변경이력 필수
    // 배정 ID → 과정 스코프 확인(강사는 S13 U 권한이 없어 도달하지 못하지만 V2 를 방어적으로 적용)
    const found = await this.db.query(`SELECT course_id FROM instructor_assignment WHERE assignment_id = $1`, [assignmentId]);
    if (found.rows.length > 0) await this.scope.requireCourse(request, Number(found.rows[0].course_id));

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'instructor_assignment', 'assignment_id', assignmentId);
      if (current.status !== 'ASSIGNED') throw conflict('INVALID_STATE_TRANSITION', `${current.status as string} 상태의 배정은 취소할 수 없습니다.`);
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(current.course_id)));
      const updated = toApi(await tx.update('instructor_assignment', { assignment_id: assignmentId }, { status: 'CANCELLED' }, { reason }));
      // P1-16(2026-09-22 확정): 남은 예정 회차가 있어도 차단하지 않고 경고만 반환한다(운영 유연성 우선, 재배정은 담당자 재량).
      const roundFilter = current.round_no === null ? '' : 'AND s.round_no = $3';
      const params = current.round_no === null ? [current.instructor_id, current.course_id] : [current.instructor_id, current.course_id, current.round_no];
      const { rows } = await tx.query(
        `SELECT count(*) AS n FROM class_schedule s WHERE s.instructor_id = $1 AND s.course_id = $2 AND s.status = 'SCHEDULED' ${roundFilter}`,
        params,
      );
      const remainingScheduledCount = Number(rows[0].n);
      return remainingScheduledCount > 0 ? { ...updated, warnings: { remainingScheduledCount } } : updated;
    });
  }
}
