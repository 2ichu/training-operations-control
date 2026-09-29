import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { type AuditedTx, AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { escapeLike, pageOf, toApi, Where } from '../common/api.js';
import { attendedDays } from '../common/attendance-rate.js';
import { assertCourseOpen, conflict, lockRow } from '../common/tx.js';
import {
  asObject, type Obj, oneOf, optIso, optObj, qDate, qEnumList, qInt, qStr, reqIntArray, reqStr,
} from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { AccessContext, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';
import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';
import { DetectionEventService } from '../verification/detection-event.service.js';

// baseline 3-3: 저장 상태 5종(계산값 NOT_CHECKED 는 저장하지 않음)
const STATUSES = ['PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED'] as const;
const DISPLAY_STATUSES = [...STATUSES, 'NOT_CHECKED'] as const;
const SOURCE_TYPES = ['OFFICIAL', 'MANUAL', 'LINKED'] as const;
const CHANGE_ACTOR_TYPES = ['USER', 'SYSTEM_BATCH', 'SYSTEM_API'] as const;
// C1: 확정 훈련생 + 실제 회차 + attendance 없음 + 회차가 휴강이 아님 → 미출결(계산, 저장하지 않음)
const NOT_CHECKED = 'NOT_CHECKED';

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
    @Inject(DetectionEventService) private readonly detectionEvents: DetectionEventService,
  ) {}

  // ── S07 일일 출결 ───────────────────────────────────────────────────────
  async roster(request: RbacRequest, scheduleId: number, query: Obj) {
    await this.scope.requireSchedule(request, scheduleId);
    const schedule = await this.findSchedule(scheduleId);
    const statusFilter = qEnumList(query, 'status', DISPLAY_STATUSES);
    const cancelled = schedule.status === 'CANCELLED';

    const { rows } = await this.db.query(
      `SELECT t.trainee_id, t.name, a.attendance_id, a.check_in_time, a.check_out_time, a.attendance_status, a.source_type,
              CASE WHEN a.attendance_id IS NOT NULL THEN a.attendance_status::text
                   WHEN $2 THEN NULL ELSE '${NOT_CHECKED}' END AS display_status
         FROM trainee_enrollment te JOIN trainee t ON t.trainee_id = te.trainee_id
         LEFT JOIN attendance a ON a.trainee_id = te.trainee_id AND a.schedule_id = $1
        WHERE te.course_id = $3 AND te.status = 'CONFIRMED' ORDER BY t.name`,
      [scheduleId, cancelled, schedule.course_id],
    );
    const filtered = statusFilter ? rows.filter((r) => statusFilter.includes(r.display_status)) : rows;
    return { items: filtered.map((r) => toApi(r)) };
  }

  async checkIn(request: RbacRequest, scheduleId: number, body: unknown) {
    await this.scope.requireSchedule(request, scheduleId);
    const o = asObject(body);
    const traineeIds = reqIntArray(o, 'trainee_ids');
    const sourceType = o.source_type === undefined ? 'MANUAL' : oneOf(o.source_type, 'source_type', SOURCE_TYPES);
    const checkInTime = optIso(o, 'check_in_time') ?? new Date().toISOString();
    // related_info: RULE_01(device_id)·RULE_02(channel, baseline `[결정 필요]` #2) 탐지 근거. 값 자체는 클라이언트가 보낸 그대로 저장한다(스키마 없는 JSON).
    const relatedInfo = optObj(o, 'related_info');

    const result = await this.transactions.run(async (tx) => {
      const schedule = await lockRow(tx, 'class_schedule', 'schedule_id', scheduleId);
      if (schedule.status === 'CANCELLED') throw conflict('SCHEDULE_CANCELLED', '휴강 처리된 회차는 출결을 기록할 수 없습니다.');
      const eligible = await this.eligibleTraineeIds(tx, Number(schedule.course_id), traineeIds);
      const notEligible = traineeIds.filter((id) => !eligible.has(id));
      const existing = await this.existingAttendance(tx, scheduleId, [...eligible]);
      const status = (await this.isLate(tx, scheduleId, checkInTime)) ? 'LATE' : 'PRESENT';

      const created: Row[] = [];
      for (const traineeId of [...eligible].filter((id) => !existing.has(id))) {
        created.push(
          await tx.create('attendance', {
            trainee_id: traineeId,
            schedule_id: scheduleId,
            check_in_time: checkInTime,
            attendance_status: status, // D-08: 입실 확인 저장 시 판정해 확정한다(이후 설정이 바뀌어도 다시 판정하지 않음)
            source_type: sourceType,
            ...(relatedInfo !== undefined ? { related_info: JSON.stringify(relatedInfo) } : {}),
          }),
        );
      }
      return {
        created: created.map((r) => toApi(r)),
        alreadyExists: [...existing.entries()].map(([traineeId, attendanceId]) => ({ traineeId, attendanceId })),
        notEligible,
      };
    });
    // 커밋 후 RULE_01·02 비동기 평가(baseline 5-3). 기다리지 않으므로 응답 시간에 영향이 없다.
    if (result.created.length > 0) this.detectionEvents.attendanceCheckedIn(scheduleId, relatedInfo);
    return result;
  }

  async confirmAbsence(request: RbacRequest, scheduleId: number, body: unknown) {
    await this.scope.requireSchedule(request, scheduleId);
    const o = asObject(body);
    const traineeIds = reqIntArray(o, 'trainee_ids');

    return this.transactions.run(async (tx) => {
      const schedule = await lockRow(tx, 'class_schedule', 'schedule_id', scheduleId);
      if (schedule.status === 'CANCELLED') throw conflict('SCHEDULE_CANCELLED', '휴강 처리된 회차는 출결을 기록할 수 없습니다.');
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(schedule.course_id))); // V7: 결석 확정은 과정 상태 검증 대상
      const eligible = await this.eligibleTraineeIds(tx, Number(schedule.course_id), traineeIds);
      const notEligible = traineeIds.filter((id) => !eligible.has(id));
      const existing = await this.existingAttendance(tx, scheduleId, [...eligible]);

      const created: Row[] = [];
      for (const traineeId of [...eligible].filter((id) => !existing.has(id))) {
        created.push(
          await tx.create('attendance', {
            trainee_id: traineeId,
            schedule_id: scheduleId,
            attendance_status: 'ABSENT',
            source_type: 'MANUAL',
          }),
        );
      }
      return {
        created: created.map((r) => toApi(r)),
        alreadyExists: [...existing.entries()].map(([traineeId, attendanceId]) => ({ traineeId, attendanceId })),
        notEligible,
      };
    });
  }

  // 퇴실 확인: schedule_id 가 경로에 없어(attendance_ids 로만 지정) 스코프는 각 행의 회차를 통해 재검사한다(V2).
  async checkOut(request: RbacRequest, body: unknown) {
    const o = asObject(body);
    const attendanceIds = reqIntArray(o, 'attendance_ids');
    const checkOutTime = optIso(o, 'check_out_time') ?? new Date().toISOString();
    const access = request.access!;

    return this.transactions.run(async (tx) => {
      const sf = this.scope.scheduleScopeFilter(access, 's.instructor_id', 2);
      // D-08: 퇴실 시각 < 수업 종료 − 조퇴 유예분 이면 조퇴. 출석(PRESENT)만 조퇴로 바꾸고, 지각(LATE)은 지각으로 둔다
      // (지각·조퇴가 겹치면 먼저 확정된 지각 유지 — 지각·조퇴 3회 = 결석 1일 환산에서 한 번만 세어지도록 상태를 하나로 둔다).
      const p = 2 + sf.params.length;
      const { rows } = await tx.query(
        `SELECT a.attendance_id, a.check_out_time, a.attendance_status,
                $${p}::timestamptz < ((s.class_date + s.end_time) AT TIME ZONE $${p + 1}) - make_interval(mins => g.early_leave_grace_minutes) AS early
           FROM attendance a JOIN class_schedule s ON s.schedule_id = a.schedule_id LEFT JOIN attendance_setting g ON g.setting_id = 1
          WHERE a.attendance_id = ANY($1::bigint[]) AND ${sf.sql} FOR UPDATE OF a`,
        [attendanceIds, ...sf.params, checkOutTime, SCHEDULE_TIMEZONE],
      );
      const early = new Set(rows.filter((r) => r.early && r.attendance_status === 'PRESENT').map((r) => Number(r.attendance_id)));
      const visible = new Map(rows.map((r) => [Number(r.attendance_id), r.check_out_time !== null]));
      const notFound = attendanceIds.filter((id) => !visible.has(id)); // 존재하지 않거나 스코프 밖(V3: 은닉)
      const alreadySet = attendanceIds.filter((id) => visible.get(id) === true);

      const updated: Row[] = [];
      for (const id of attendanceIds.filter((i) => visible.get(i) === false)) {
        const set: Row = early.has(id) ? { check_out_time: checkOutTime, attendance_status: 'EARLY_LEAVE' } : { check_out_time: checkOutTime };
        updated.push(await tx.update('attendance', { attendance_id: id }, set));
      }
      return { updated: updated.map((r) => toApi(r)), alreadyExists: alreadySet, notFound };
    });
  }

  // D-08: 입실 시각 > 수업 시작 + 지각 유예분 이면 지각(경계 시각 정각은 출석). 회차 날짜·시각은 APP_TIMEZONE 벽시계 기준.
  private async isLate(tx: AuditedTx, scheduleId: number, checkInTime: string): Promise<boolean> {
    const { rows } = await tx.query(
      `SELECT $1::timestamptz > ((s.class_date + s.start_time) AT TIME ZONE $2) + make_interval(mins => g.late_grace_minutes) AS late
         FROM class_schedule s LEFT JOIN attendance_setting g ON g.setting_id = 1 WHERE s.schedule_id = $3`,
      [checkInTime, SCHEDULE_TIMEZONE, scheduleId],
    );
    return rows[0]?.late === true;
  }

  // ── S08 과정별 출결 ─────────────────────────────────────────────────────
  async matrix(request: RbacRequest, courseId: number, query: Obj) {
    await this.scope.requireCourse(request, courseId);
    const access = request.access!;
    const name = qStr(query, 'trainee_name');
    const statusFilter = qEnumList(query, 'status', DISPLAY_STATUSES);

    const sf = this.scope.scheduleScopeFilter(access, 's.instructor_id', 2);
    const schedules = (
      await this.db.query(`SELECT s.schedule_id, s.round_no, s.class_date, s.status FROM class_schedule s WHERE s.course_id = $1 AND ${sf.sql} ORDER BY s.round_no`, [courseId, ...sf.params])
    ).rows;

    const traineeWhere = new Where();
    traineeWhere.add((p) => `te.course_id = ${p}`, courseId);
    traineeWhere.clauses.push(`te.status = 'CONFIRMED'`);
    if (name) traineeWhere.add((p) => `t.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(name)}%`);
    const trainees = (
      await this.db.query(`SELECT t.trainee_id, t.name FROM trainee_enrollment te JOIN trainee t ON t.trainee_id = te.trainee_id WHERE ${traineeWhere.sql} ORDER BY t.name`, traineeWhere.params)
    ).rows;

    const scheduleIds = schedules.map((s) => s.schedule_id);
    const attendances = scheduleIds.length
      ? (await this.db.query(`SELECT attendance_id, trainee_id, schedule_id, attendance_status FROM attendance WHERE schedule_id = ANY($1::bigint[])`, [scheduleIds])).rows
      : [];
    const byKey = new Map(attendances.map((a) => [`${a.trainee_id}:${a.schedule_id}`, a]));

    const items = trainees.map((t) => {
      const counts = { present: 0, late: 0, earlyLeave: 0, excused: 0 };
      let applicable = 0;
      const cells = schedules.map((s) => {
        const cancelled = s.status === 'CANCELLED';
        const found = byKey.get(`${t.trainee_id}:${s.schedule_id}`);
        const status = (found?.attendance_status as string | undefined) ?? null;
        if (!cancelled) {
          applicable += 1;
          if (status === 'PRESENT') counts.present += 1;
          else if (status === 'LATE') counts.late += 1;
          else if (status === 'EARLY_LEAVE') counts.earlyLeave += 1;
          else if (status === 'EXCUSED') counts.excused += 1;
        }
        // attendanceId: 셀에서 S09 정정으로 들어가기 위한 키(미출결 셀은 null — 최초 입실·결석 확정은 S07, C1)
        return { scheduleId: Number(s.schedule_id), attendanceId: found ? Number(found.attendance_id) : null, displayStatus: status ?? (cancelled ? null : NOT_CHECKED) };
      });
      return { traineeId: Number(t.trainee_id), name: t.name as string, attendanceRate: applicable > 0 ? attendedDays(counts) / applicable : null, cells }; // 수료 후보(S02)와 같은 산식(common/attendance-rate.ts)
    });
    const filtered = statusFilter ? items.filter((r) => r.cells.some((c) => c.displayStatus !== null && (statusFilter as readonly string[]).includes(c.displayStatus))) : items;
    return { schedules: schedules.map((s) => toApi(s)), items: filtered };
  }

  // ── S09 출결 수정 ───────────────────────────────────────────────────────
  async detail(request: RbacRequest, attendanceId: number) {
    return toApi(await this.findWithScope(request, attendanceId));
  }

  async correct(request: RbacRequest, attendanceId: number, body: unknown) {
    const o = asObject(body);
    const reason = reqStr(o, 'reason', 500); // V6
    if (!('expected_last_modified_at' in o)) {
      throw new BadRequestException({ code: 'VALIDATION', field: 'expected_last_modified_at', message: '필수입니다(현재 값을 그대로 보내거나, 정정 이력이 없으면 null)' });
    }
    const expectedRaw = o.expected_last_modified_at;
    if (expectedRaw !== null && typeof expectedRaw !== 'string') {
      throw new BadRequestException({ code: 'VALIDATION', field: 'expected_last_modified_at', message: '문자열 또는 null 이어야 합니다' });
    }
    const set: Row = {};
    if ('check_in_time' in o) set.check_in_time = o.check_in_time === null ? null : optIso(o, 'check_in_time');
    if ('check_out_time' in o) set.check_out_time = o.check_out_time === null ? null : optIso(o, 'check_out_time');
    if (o.attendance_status !== undefined) set.attendance_status = oneOf(o.attendance_status, 'attendance_status', STATUSES);
    if (Object.keys(set).length === 0) throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'attendance', 'attendance_id', attendanceId);
      await this.scope.requireSchedule(request, Number(current.schedule_id)); // V2 방어적 재검사(현재는 OPS_MANAGER만 도달)
      const schedule = await lockRow(tx, 'class_schedule', 'schedule_id', Number(current.schedule_id));
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(schedule.course_id))); // V7

      const currentExpected = current.last_modified_at ? new Date(current.last_modified_at as string).toISOString() : null;
      if (expectedRaw !== currentExpected) throw conflict('STALE_ATTENDANCE', '다른 곳에서 이미 수정되었습니다. 최신 값을 다시 불러오세요.');

      const now = new Date().toISOString();
      const updated = await tx.update('attendance', { attendance_id: attendanceId }, { ...set, last_modified_at: now });
      await this.recordChangeLog(tx, attendanceId, Number(current.trainee_id), current, updated, reason);
      return toApi(updated);
    });
  }

  // ── S10 출결 수정이력 ───────────────────────────────────────────────────
  async changeLogs(query: Obj) {
    const where = new Where();
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `s.course_id = ${p}`, courseId);
    const traineeId = qInt(query, 'trainee_id');
    if (traineeId) where.add((p) => `l.trainee_id = ${p}`, traineeId);
    const traineeName = qStr(query, 'trainee_name');
    if (traineeName) where.add((p) => `t.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(traineeName)}%`);
    const from = qDate(query, 'from');
    if (from) where.add((p) => `l.changed_at >= ${p}::date`, from);
    const to = qDate(query, 'to');
    if (to) where.add((p) => `l.changed_at < (${p}::date + 1)`, to);
    const actorType = qEnumList(query, 'actor_type', CHANGE_ACTOR_TYPES);
    if (actorType) where.add((p) => `l.actor_type = ANY(${p}::attendance_change_actor_type[])`, actorType);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT l.log_id, l.attendance_id, l.trainee_id, t.name AS trainee_name, l.actor_type, l.changed_by, u.name AS changed_by_name,
              l.changed_at, l.before_value, l.after_value, l.reason, s.schedule_id, s.round_no, s.class_date, s.course_id, c.course_name,
              count(*) OVER() AS total
         FROM attendance_change_log l
         JOIN attendance a ON a.attendance_id = l.attendance_id
         JOIN class_schedule s ON s.schedule_id = a.schedule_id
         JOIN course c ON c.course_id = s.course_id
         JOIN trainee t ON t.trainee_id = l.trainee_id
         LEFT JOIN user_account u ON u.user_id = l.changed_by
        WHERE ${where.sql} ORDER BY l.changed_at DESC, l.log_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }

  // ── S05 훈련생 상세: 출결 요약(baseline 5-2, "회차별 출결(미출결 계산 포함)") ──
  async attendanceSummary(request: RbacRequest, traineeId: number, query: Obj) {
    await this.scope.requireTrainee(request, traineeId);
    const courseId = qInt(query, 'course_id');
    if (!courseId) throw new BadRequestException({ code: 'VALIDATION', field: 'course_id', message: '필수입니다' });
    // 훈련생 접근 권한과 별개로 과정 범위도 확인한다(강사는 같은 훈련생이라도 본인 배정 과정의 출결만 — V2·V4)
    await this.scope.requireCourse(request, courseId);
    if ((await this.db.query(`SELECT 1 FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2`, [traineeId, courseId])).rows.length === 0) {
      throw new NotFoundException('대상을 찾을 수 없습니다.');
    }

    const { rows } = await this.db.query(
      `SELECT s.schedule_id, s.round_no, s.class_date, s.status AS schedule_status,
              a.attendance_id, a.check_in_time, a.check_out_time, a.attendance_status
         FROM class_schedule s
         LEFT JOIN attendance a ON a.schedule_id = s.schedule_id AND a.trainee_id = $2
        WHERE s.course_id = $1 ORDER BY s.round_no`,
      [courseId, traineeId],
    );
    const items = rows.map((r) => {
      const cancelled = r.schedule_status === 'CANCELLED';
      const displayStatus = cancelled ? null : r.attendance_id !== null ? (r.attendance_status as string) : NOT_CHECKED;
      return { ...toApi({ schedule_id: r.schedule_id, round_no: r.round_no, class_date: r.class_date, schedule_status: r.schedule_status, attendance_id: r.attendance_id, check_in_time: r.check_in_time, check_out_time: r.check_out_time }), displayStatus };
    });
    return { items };
  }

  // ── 내부 헬퍼 ───────────────────────────────────────────────────────────
  private async findSchedule(scheduleId: number): Promise<Row> {
    const { rows } = await this.db.query(`SELECT schedule_id, course_id, status FROM class_schedule WHERE schedule_id = $1`, [scheduleId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    return rows[0];
  }

  private async findWithScope(request: RbacRequest, attendanceId: number): Promise<Row> {
    const { rows } = await this.db.query(`SELECT * FROM attendance WHERE attendance_id = $1`, [attendanceId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    await this.scope.requireSchedule(request, Number(rows[0].schedule_id));
    return rows[0];
  }

  // 과정/회차/훈련생 관계 검증: 확정(CONFIRMED) 등록 건만 출결 대상이다.
  private async eligibleTraineeIds(tx: AuditedTx, courseId: number, traineeIds: number[]): Promise<Set<number>> {
    const { rows } = await tx.query(
      `SELECT trainee_id FROM trainee_enrollment WHERE course_id = $1 AND status = 'CONFIRMED' AND trainee_id = ANY($2::bigint[])`,
      [courseId, traineeIds],
    );
    return new Set(rows.map((r) => Number(r.trainee_id)));
  }

  private async existingAttendance(tx: AuditedTx, scheduleId: number, traineeIds: number[]): Promise<Map<number, number>> {
    if (traineeIds.length === 0) return new Map();
    const { rows } = await tx.query(`SELECT trainee_id, attendance_id FROM attendance WHERE schedule_id = $1 AND trainee_id = ANY($2::bigint[])`, [scheduleId, traineeIds]);
    return new Map(rows.map((r) => [Number(r.trainee_id), Number(r.attendance_id)]));
  }

  // attendance_change_log 는 trainee/instructor_change_log 와 스키마가 달라(actor_type 지원, system-design STEP 5.3 #10)
  // AuditedTx 의 공용 changeLog 메커니즘을 쓰지 않고 같은 트랜잭션에서 직접 기록한다(감사 미들웨어 자체는 수정하지 않음).
  private async recordChangeLog(tx: AuditedTx, attendanceId: number, traineeId: number, before: Row, after: Row, reason: string): Promise<void> {
    await tx.query(
      `INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, changed_by, before_value, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [attendanceId, traineeId, tx.actor.actorType, tx.actor.actorUserId, JSON.stringify(before), JSON.stringify(after), reason],
    );
  }
}
