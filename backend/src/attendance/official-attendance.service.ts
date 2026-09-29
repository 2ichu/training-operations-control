import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AuditContext } from '../audit/audit-context.js';
import { type AuditedTx, AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { pageOf, toApi } from '../common/api.js';
import { assertCourseOpen, lockRow } from '../common/tx.js';
import { type Obj, qInt } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';
import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';
import { DetectionRuleService } from '../verification/detection-rule.service.js';
import { type AttendanceValues, compareAttendance, OfficialFileError, type OfficialRow, parseOfficialFile } from './official-attendance.parse.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024;

export type ImportResult = 'CREATED' | 'UPDATED' | 'CONVERTED' | 'UNCHANGED' | 'CASE' | 'MISMATCH' | 'ERROR';
interface RowOutcome {
  result: ImportResult;
  message: string;
  attendanceId?: number;
  caseId?: number;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

// D-12 확정(2026-09-29): 공식 출결은 CSV 파일 업로드로 받아 내부 기록과 대사한다(system-design STEP 8.2).
// - 내부 기록이 없으면 공식 값으로 생성(source_type=OFFICIAL), 이미 공식이면 정정으로 갱신(변경이력 기록).
// - 내부 기록(수기·연계)이 있으면 비교: 임계치(RULE_07 tolerance_minutes) 이내면 공식 값으로 갱신하고 공식으로 전환,
//   초과 불일치면 attendance 는 그대로 두고 RULE_07 확인 필요 건을 만든다(자동 덮어쓰기 없음).
// - 한 번의 업로드는 한 트랜잭션이다. 행 단위 검증 오류는 그 행만 미반영으로 보고하고 나머지는 처리한다(같은 파일을 고쳐 다시 올리면
//   이미 반영된 행은 변경 없음으로 처리되어 멱등). 변경 행위자는 시스템(SYSTEM_BATCH)으로 남겨 사람 수정 반복 탐지(RULE_05·06)에
//   섞이지 않게 하고, 실제 업로드한 사용자는 attendance_source_raw.uploaded_by 와 audit_log 사유(official-import:user=ID)에 남는다.
@Injectable()
export class OfficialAttendanceService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
    @Inject(AuditContext) private readonly auditContext: AuditContext,
    @Inject(DetectionRuleService) private readonly rules: DetectionRuleService,
  ) {}

  async importFile(request: RbacRequest, courseId: number, file: { originalname: string; size: number; buffer: Buffer } | undefined) {
    await this.scope.requireCourse(request, courseId);
    if (!file) throw new BadRequestException({ code: 'VALIDATION', field: 'file', message: '파일이 필요합니다' });
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: `파일은 ${MAX_FILE_SIZE / 1024 / 1024}MB 이하여야 합니다` });
    let rows: OfficialRow[];
    try {
      rows = parseOfficialFile(file.buffer.toString('utf8'));
    } catch (e) {
      if (e instanceof OfficialFileError) throw new BadRequestException({ code: 'INVALID_FILE', message: e.message });
      throw e;
    }

    const userId = request.access!.userId;
    const batchId = randomUUID();
    const fileName = file.originalname.slice(0, 255);
    const outcomes = await this.auditContext.runAsSystem('SYSTEM_BATCH', `official-import:user=${userId}`, () =>
      this.transactions.run(async (tx) => {
        assertCourseOpen(await lockRow(tx, 'course', 'course_id', courseId)); // V7: 종료·중단 과정은 출결을 바꾸지 않는다
        const ctx = await this.loadContext(tx, courseId);
        const seen = new Set<string>();
        const out: { row: OfficialRow; outcome: RowOutcome }[] = [];
        for (const row of rows) {
          const outcome = await this.processRow(tx, courseId, ctx, seen, row);
          await tx.create('attendance_source_raw', {
            batch_id: batchId,
            file_name: fileName,
            row_no: row.rowNo,
            course_id: courseId,
            uploaded_by: userId,
            raw_payload: JSON.stringify(row.raw),
            result: outcome.result,
            message: outcome.message.slice(0, 500),
            attendance_id: outcome.attendanceId ?? null,
            case_id: outcome.caseId ?? null,
            processed: outcome.result !== 'ERROR',
            processed_at: outcome.result !== 'ERROR' ? new Date().toISOString() : null,
          });
          out.push({ row, outcome });
        }
        return out;
      }),
    );

    const counts: Record<string, number> = {};
    for (const { outcome } of outcomes) counts[outcome.result] = (counts[outcome.result] ?? 0) + 1;
    return {
      batchId,
      fileName,
      total: outcomes.length,
      counts,
      rows: outcomes.map(({ row, outcome }) => ({ rowNo: row.rowNo, roundNo: row.raw.round_no ?? null, traineeName: row.raw.trainee_name ?? null, result: outcome.result, message: outcome.message, attendanceId: outcome.attendanceId ?? null, caseId: outcome.caseId ?? null })),
    };
  }

  // 업로드 이력(배치 단위, 최신순)
  async listBatches(query: Obj) {
    const page = pageOf(query);
    const courseId = qInt(query, 'course_id');
    const { rows } = await this.db.query(
      `SELECT r.batch_id, min(r.file_name) AS file_name, min(r.received_at) AS received_at, r.course_id, c.course_name, u.name AS uploaded_by_name,
              count(*)::int AS total,
              (count(*) FILTER (WHERE r.result = 'CREATED'))::int AS created, (count(*) FILTER (WHERE r.result = 'UPDATED'))::int AS updated,
              (count(*) FILTER (WHERE r.result = 'CONVERTED'))::int AS converted, (count(*) FILTER (WHERE r.result = 'UNCHANGED'))::int AS unchanged,
              (count(*) FILTER (WHERE r.result IN ('CASE', 'MISMATCH')))::int AS mismatched, (count(*) FILTER (WHERE r.result = 'ERROR'))::int AS errors,
              count(*) OVER() AS total_batches
         FROM attendance_source_raw r JOIN course c ON c.course_id = r.course_id JOIN user_account u ON u.user_id = r.uploaded_by
        WHERE ($1::bigint IS NULL OR r.course_id = $1)
        GROUP BY r.batch_id, r.course_id, c.course_name, u.name
        ORDER BY min(r.received_at) DESC, r.batch_id LIMIT ${page.size} OFFSET ${page.offset}`,
      [courseId ?? null],
    );
    const total = rows.length ? Number(rows[0].total_batches) : 0;
    return { items: rows.map(({ total_batches: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }

  async batchRows(batchId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new BadRequestException({ code: 'VALIDATION', field: 'batchId', message: '올바른 값이 아닙니다' });
    const { rows } = await this.db.query(
      `SELECT row_no, raw_payload->>'round_no' AS round_no, raw_payload->>'trainee_name' AS trainee_name, raw_payload, result, message, attendance_id, case_id FROM attendance_source_raw WHERE batch_id = $1 ORDER BY row_no`,
      [batchId],
    );
    return { items: rows.map((r) => toApi(r)) };
  }

  // ── 내부 ────────────────────────────────────────────────────────────────
  private async loadContext(tx: AuditedTx, courseId: number) {
    const schedules = new Map<number, Row>(
      (await tx.query(`SELECT schedule_id, round_no, status FROM class_schedule WHERE course_id = $1`, [courseId])).rows.map((r) => [Number(r.round_no), r]),
    );
    const trainees = new Map<string, { traineeId: number; birthDate: string | null }[]>();
    const { rows } = await tx.query(
      `SELECT t.trainee_id, t.name, to_char(t.birth_date, 'YYYY-MM-DD') AS birth_date
         FROM trainee_enrollment te JOIN trainee t ON t.trainee_id = te.trainee_id WHERE te.course_id = $1 AND te.status = 'CONFIRMED'`,
      [courseId],
    );
    for (const r of rows) {
      trainees.set(r.name as string, [...(trainees.get(r.name as string) ?? []), { traineeId: Number(r.trainee_id), birthDate: (r.birth_date as string | null) ?? null }]);
    }
    const rule = (await tx.query(`SELECT params FROM detection_rule WHERE rule_code = 'RULE_07'`)).rows[0];
    const toleranceMinutes = Number((rule?.params as { tolerance_minutes?: number } | undefined)?.tolerance_minutes ?? 15);
    return { schedules, trainees, toleranceMinutes };
  }

  private async processRow(tx: AuditedTx, courseId: number, ctx: Awaited<ReturnType<OfficialAttendanceService['loadContext']>>, seen: Set<string>, row: OfficialRow): Promise<RowOutcome> {
    if (row.error) return { result: 'ERROR', message: row.error };
    const schedule = ctx.schedules.get(row.roundNo!);
    if (!schedule) return { result: 'ERROR', message: `이 과정에 ${row.roundNo}회차가 없습니다` };
    if (schedule.status === 'CANCELLED') return { result: 'ERROR', message: `${row.roundNo}회차는 휴강 처리되어 출결을 반영할 수 없습니다` };
    // 이름으로 찾고, 생년월일이 있으면 그 값과 일치하는 사람만 남긴다. 한 명으로 특정되지 않으면 오류.
    const candidates = (ctx.trainees.get(row.traineeName!) ?? []).filter((t) => !row.birthDate || t.birthDate === row.birthDate);
    if (candidates.length === 0) return { result: 'ERROR', message: '확정된 훈련생 중 이름(·생년월일)이 일치하는 사람이 없습니다' };
    if (candidates.length > 1) return { result: 'ERROR', message: '이름이 같은 훈련생이 둘 이상이라 특정할 수 없습니다(생년월일 열을 채워 주세요)' };
    const traineeId = candidates[0].traineeId;
    const scheduleId = Number(schedule.schedule_id);
    const key = `${scheduleId}:${traineeId}`;
    if (seen.has(key)) return { result: 'ERROR', message: '파일 안에서 같은 훈련생·회차가 중복됩니다' };
    seen.add(key);

    const official: AttendanceValues = {
      status: row.status!,
      checkIn: await this.at(tx, scheduleId, row.checkIn ?? null),
      checkOut: await this.at(tx, scheduleId, row.checkOut ?? null),
    };
    const { rows: found } = await tx.query(`SELECT * FROM attendance WHERE schedule_id = $1 AND trainee_id = $2 FOR UPDATE`, [scheduleId, traineeId]);
    const existing = found[0];

    if (!existing) {
      const created = await tx.create('attendance', {
        trainee_id: traineeId,
        schedule_id: scheduleId,
        check_in_time: iso(official.checkIn),
        check_out_time: iso(official.checkOut),
        attendance_status: official.status,
        source_type: 'OFFICIAL',
      });
      return { result: 'CREATED', message: '공식 출결로 새로 기록했습니다', attendanceId: Number(created.attendance_id) };
    }

    const attendanceId = Number(existing.attendance_id);
    const internal: AttendanceValues = {
      status: existing.attendance_status as string,
      checkIn: existing.check_in_time ? new Date(existing.check_in_time as string) : null,
      checkOut: existing.check_out_time ? new Date(existing.check_out_time as string) : null,
    };

    if (existing.source_type === 'OFFICIAL') {
      // 이미 공식 기록 → 최신 공식 값으로 정정(STEP 8.2 4번). 값이 같으면 변경 없음.
      if (compareAttendance(internal, official, 0) === 'IDENTICAL') return { result: 'UNCHANGED', message: '이미 같은 공식 값입니다', attendanceId };
      await this.apply(tx, existing, traineeId, official, '공식 출결 정정 반영');
      return { result: 'UPDATED', message: '공식 값으로 정정했습니다', attendanceId };
    }

    const cmp = compareAttendance(internal, official, ctx.toleranceMinutes);
    if (cmp === 'MISMATCH') {
      const snap = (v: AttendanceValues) => ({ status: v.status, check_in_time: iso(v.checkIn), check_out_time: iso(v.checkOut) });
      const recorded = await this.rules.recordOfficialMismatch(tx, {
        courseId,
        traineeId,
        attendanceId,
        scheduleId,
        official: snap(official),
        internal: { ...snap(internal), source_type: existing.source_type as string },
      });
      if (!recorded) return { result: 'MISMATCH', message: '내부 기록과 다르지만 RULE_07 이 꺼져 있어 확인 필요 건은 만들지 않았습니다(내부 기록은 그대로)', attendanceId };
      return {
        result: 'CASE',
        message: `내부 기록과 ${recorded.toleranceMinutes}분 기준으로 불일치해 확인 필요 건을 ${recorded.created ? '만들었습니다' : '갱신했습니다'}(내부 기록은 그대로)`,
        attendanceId,
        caseId: recorded.caseId,
      };
    }
    // 임계치 이내 일치 → 공식 값으로 갱신하고 공식으로 전환. 공식에 없는 시각은 내부 값을 유지한다.
    const merged: AttendanceValues = { status: official.status, checkIn: official.checkIn ?? internal.checkIn, checkOut: official.checkOut ?? internal.checkOut };
    await this.apply(tx, existing, traineeId, merged, '공식 출결 대사 반영(임계치 이내 일치, 공식으로 전환)');
    return { result: 'CONVERTED', message: '내부 기록과 일치해 공식 기록으로 전환했습니다', attendanceId };
  }

  private async apply(tx: AuditedTx, existing: Row, traineeId: number, values: AttendanceValues, reason: string): Promise<void> {
    const attendanceId = Number(existing.attendance_id);
    const snapshot = (status: unknown, inTime: unknown, outTime: unknown, source: unknown) => ({
      attendance_status: status,
      check_in_time: inTime ? new Date(inTime as string).toISOString() : null,
      check_out_time: outTime ? new Date(outTime as string).toISOString() : null,
      source_type: source,
    });
    const before = snapshot(existing.attendance_status, existing.check_in_time, existing.check_out_time, existing.source_type);
    const updated = await tx.update('attendance', { attendance_id: attendanceId }, {
      attendance_status: values.status,
      check_in_time: iso(values.checkIn),
      check_out_time: iso(values.checkOut),
      source_type: 'OFFICIAL',
      last_modified_at: new Date().toISOString(), // S09 에 열려 있던 정정 화면이 낡은 값으로 저장하지 못하게 한다(낙관적 잠금)
    });
    const after = snapshot(updated.attendance_status, updated.check_in_time, updated.check_out_time, updated.source_type);
    await tx.query(
      `INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, changed_by, before_value, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [attendanceId, traineeId, tx.actor.actorType, tx.actor.actorUserId, JSON.stringify(before), JSON.stringify(after), reason],
    );
  }

  // 회차 날짜 + "HH:MM:SS"(APP_TIMEZONE 벽시계) → 시각
  private async at(tx: AuditedTx, scheduleId: number, time: string | null): Promise<Date | null> {
    if (!time) return null;
    const { rows } = await tx.query(`SELECT (s.class_date + $2::time) AT TIME ZONE $3 AS ts FROM class_schedule s WHERE s.schedule_id = $1`, [scheduleId, time, SCHEDULE_TIMEZONE]);
    return new Date(rows[0].ts as string);
  }
}
