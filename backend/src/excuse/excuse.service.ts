import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditContext } from '../audit/audit-context.js';
import { AuditLogService } from '../audit/audit-log.service.js';
import { type AuditedTx, AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { escapeLike, pageOf, toApi, Where } from '../common/api.js';
import { assertCourseOpen, conflict, lockRow } from '../common/tx.js';
import { asObject, type Obj, oneOf, optStr, qDate, qEnumList, qInt, qStr, reqInt, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';

// 화면: S30 공결(사유결석) 신청·승인. 증빙서류를 확인해 승인하면 해당 회차 출결이 "인정결석(EXCUSED)"이 된다.
// 출결 값을 바꾸는 방식은 기존 정정(S09)과 같다: attendance 갱신 + attendance_change_log 기록(사유에 공결 신청 번호를 남김).
export const REASON_TYPES = ['MEDICAL', 'MILITARY', 'INTERVIEW', 'FAMILY_EVENT', 'OTHER'] as const;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads');
const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;
// 증빙은 촬영 이미지·PDF 만 받는다(브라우저 미리보기용). 확장자와 파일 머리(매직 바이트)를 함께 확인한다.
const EVIDENCE_TYPES: Record<string, { mime: string; magic: (b: Buffer) => boolean }> = {
  '.pdf': { mime: 'application/pdf', magic: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
  '.png': { mime: 'image/png', magic: (b) => b.subarray(0, 4).toString('hex') === '89504e47' },
  '.jpg': { mime: 'image/jpeg', magic: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  '.jpeg': { mime: 'image/jpeg', magic: (b) => b.subarray(0, 3).toString('hex') === 'ffd8ff' },
  '.webp': { mime: 'image/webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

export interface UploadedFileLike {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class ExcuseService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
    @Inject(AuditContext) private readonly auditContext: AuditContext,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  async list(request: RbacRequest, query: Obj) {
    const { page, size, offset } = pageOf(query);
    const where = new Where();
    where.addFilter((i) => this.scope.scheduleScopeFilter(request.access!, 's.instructor_id', i));
    const statuses = qEnumList(query, 'status', STATUSES);
    if (statuses) where.add((p) => `r.status = ANY(${p}::text[])`, statuses);
    const courseId = qInt(query, 'course_id');
    if (courseId) where.add((p) => `r.course_id = ${p}`, courseId);
    const reason = qStr(query, 'reason_type', 20);
    if (reason) where.add((p) => `r.reason_type = ${p}`, oneOf(reason, 'reason_type', REASON_TYPES));
    const from = qDate(query, 'from');
    if (from) where.add((p) => `s.class_date >= ${p}`, from);
    const to = qDate(query, 'to');
    if (to) where.add((p) => `s.class_date <= ${p}`, to);
    const name = qStr(query, 'trainee_name', 50);
    if (name) where.add((p) => `t.name LIKE ${p}`, `%${escapeLike(name)}%`);

    const base = `FROM excuse_request r JOIN trainee t ON t.trainee_id = r.trainee_id JOIN class_schedule s ON s.schedule_id = r.schedule_id
                  JOIN course c ON c.course_id = r.course_id WHERE ${where.sql}`;
    const total = Number((await this.db.query(`SELECT count(*) AS n ${base}`, where.params)).rows[0].n);
    const { rows } = await this.db.query(
      `SELECT r.request_id, r.trainee_id, t.name AS trainee_name, r.course_id, c.course_name, r.schedule_id, s.round_no, s.class_date,
              r.reason_type, r.status, r.requested_at, r.decided_at,
              (SELECT count(*) FROM excuse_evidence e WHERE e.request_id = r.request_id) AS evidence_count
         ${base} ORDER BY (r.status = 'PENDING') DESC, r.requested_at DESC, r.request_id DESC LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}`,
      [...where.params, size, offset],
    );
    return { items: rows.map((r) => toApi(r)), total, page, size };
  }

  async detail(request: RbacRequest, requestId: number) {
    const row = await this.findScoped(request, requestId);
    const { rows } = await this.db.query(
      `SELECT r.*, t.name AS trainee_name, c.course_name, s.round_no, s.class_date,
              ru.name AS requested_by_name, du.name AS decided_by_name
         FROM excuse_request r JOIN trainee t ON t.trainee_id = r.trainee_id JOIN class_schedule s ON s.schedule_id = r.schedule_id
         JOIN course c ON c.course_id = r.course_id JOIN user_account ru ON ru.user_id = r.requested_by
         LEFT JOIN user_account du ON du.user_id = r.decided_by WHERE r.request_id = $1`,
      [Number(row.request_id)],
    );
    const evidence = await this.db.query(
      `SELECT evidence_id, file_name, file_size, mime_type, uploaded_at FROM excuse_evidence WHERE request_id = $1 ORDER BY evidence_id`,
      [requestId],
    );
    const attendance = await this.db.query(`SELECT attendance_status FROM attendance WHERE trainee_id = $1 AND schedule_id = $2`, [rows[0].trainee_id, rows[0].schedule_id]);
    return { ...toApi(rows[0]), currentAttendanceStatus: attendance.rows[0]?.attendance_status ?? null, evidence: evidence.rows.map((e) => toApi(e)) };
  }

  async create(request: RbacRequest, body: unknown) {
    const o = asObject(body);
    const traineeId = reqInt(o, 'trainee_id');
    const scheduleId = reqInt(o, 'schedule_id');
    const reasonType = oneOf(o.reason_type, 'reason_type', REASON_TYPES);
    const reasonNote = optStr(o, 'reason_note', 500) ?? null;
    await this.scope.requireSchedule(request, scheduleId);

    return this.transactions.run(async (tx) => {
      const schedule = await lockRow(tx, 'class_schedule', 'schedule_id', scheduleId);
      if (schedule.status === 'CANCELLED') throw conflict('SCHEDULE_CANCELLED', '휴강 처리된 회차에는 공결을 신청할 수 없습니다.');
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(schedule.course_id)));
      const enrolled = await tx.query(`SELECT 1 FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2 AND status = 'CONFIRMED'`, [traineeId, schedule.course_id]);
      if (enrolled.rows.length === 0) throw conflict('NOT_ENROLLED', '이 과정에 확정 등록된 훈련생만 공결을 신청할 수 있습니다.');
      const created = await tx.create('excuse_request', {
        trainee_id: traineeId, schedule_id: scheduleId, course_id: schedule.course_id, reason_type: reasonType, reason_note: reasonNote, requested_by: tx.actor.actorUserId,
      });
      return toApi(created);
    });
  }

  async addEvidence(request: RbacRequest, requestId: number, file: UploadedFileLike | undefined) {
    if (!file) throw new BadRequestException({ code: 'VALIDATION', field: 'file', message: '파일이 필요합니다' });
    if (file.size > MAX_EVIDENCE_SIZE) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: `증빙 파일은 ${MAX_EVIDENCE_SIZE / 1024 / 1024}MB 이하여야 합니다` });
    const ext = extname(file.originalname).toLowerCase();
    const type = EVIDENCE_TYPES[ext];
    if (!type || !type.magic(file.buffer)) throw new BadRequestException({ code: 'VALIDATION', field: 'file', message: '증빙은 PDF 또는 이미지(PNG·JPG·WEBP) 파일만 올릴 수 있습니다' });
    const current = await this.findScoped(request, requestId);
    if (current.status !== 'PENDING') throw conflict('INVALID_STATE_TRANSITION', '대기 중인 신청에만 증빙을 추가할 수 있습니다.');

    await mkdir(UPLOAD_DIR, { recursive: true });
    const storedName = `${randomUUID()}-${basename(file.originalname)}`;
    await writeFile(join(UPLOAD_DIR, storedName), file.buffer);
    return this.transactions.run(async (tx) => {
      const locked = await tx.query(`SELECT status FROM excuse_request WHERE request_id = $1 FOR UPDATE`, [requestId]);
      if (locked.rows[0]?.status !== 'PENDING') throw conflict('INVALID_STATE_TRANSITION', '대기 중인 신청에만 증빙을 추가할 수 있습니다.');
      const created = await tx.create('excuse_evidence', {
        request_id: requestId, file_name: file.originalname, file_path: storedName, file_size: file.size, mime_type: type.mime, uploaded_by: tx.actor.actorUserId,
      });
      return toApi(created);
    });
  }

  async evidenceFile(request: RbacRequest, requestId: number, evidenceId: number): Promise<{ absolutePath: string; fileName: string; mime: string }> {
    await this.findScoped(request, requestId);
    const { rows } = await this.db.query(`SELECT * FROM excuse_evidence WHERE evidence_id = $1 AND request_id = $2`, [evidenceId, requestId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    const actor = this.auditContext.require();
    await this.audit.record({ actorType: 'USER', actorUserId: actor.actorUserId, action: 'VIEW_SENSITIVE', targetTable: 'excuse_evidence', targetId: evidenceId, ip: actor.ip });
    return { absolutePath: join(UPLOAD_DIR, rows[0].file_path as string), fileName: rows[0].file_name as string, mime: rows[0].mime_type as string };
  }

  async approve(request: RbacRequest, requestId: number, body: unknown) {
    const note = optStr(asObject(body ?? {}), 'decision_note', 500) ?? null;
    await this.findScoped(request, requestId);
    return this.transactions.run(async (tx) => {
      const current = await this.lockPending(tx, requestId);
      const evidence = await tx.query(`SELECT 1 FROM excuse_evidence WHERE request_id = $1 LIMIT 1`, [requestId]);
      if (evidence.rows.length === 0) throw conflict('EVIDENCE_REQUIRED', '증빙서류가 첨부되지 않은 신청은 승인할 수 없습니다.');
      const schedule = await lockRow(tx, 'class_schedule', 'schedule_id', Number(current.schedule_id));
      if (schedule.status === 'CANCELLED') throw conflict('SCHEDULE_CANCELLED', '휴강 처리된 회차의 출결은 바꿀 수 없습니다.');
      assertCourseOpen(await lockRow(tx, 'course', 'course_id', Number(current.course_id)));

      const traineeId = Number(current.trainee_id);
      const existing = await tx.query(`SELECT attendance_id FROM attendance WHERE trainee_id = $1 AND schedule_id = $2 FOR UPDATE`, [traineeId, current.schedule_id]);
      let attendanceId: number;
      if (existing.rows.length === 0) {
        const created = await tx.create('attendance', { trainee_id: traineeId, schedule_id: current.schedule_id, attendance_status: 'EXCUSED', source_type: 'MANUAL' });
        attendanceId = Number(created.attendance_id);
      } else {
        attendanceId = Number(existing.rows[0].attendance_id);
        const before = await lockRow(tx, 'attendance', 'attendance_id', attendanceId);
        if (before.attendance_status === 'PRESENT') throw conflict('ALREADY_PRESENT', '이미 출석으로 기록된 회차는 공결로 바꿀 수 없습니다. 출결 정정(S09)을 이용하세요.');
        if (before.attendance_status !== 'EXCUSED') {
          const updated = await tx.update('attendance', { attendance_id: attendanceId }, { attendance_status: 'EXCUSED', last_modified_at: new Date().toISOString() });
          await tx.query(
            `INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, changed_by, before_value, after_value, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [attendanceId, traineeId, tx.actor.actorType, tx.actor.actorUserId, JSON.stringify(before), JSON.stringify(updated), `공결 승인(신청 #${requestId})`],
          );
        }
      }
      const decided = await tx.update('excuse_request', { request_id: requestId }, {
        status: 'APPROVED', decided_by: tx.actor.actorUserId, decided_at: new Date().toISOString(), decision_note: note, attendance_id: attendanceId,
      });
      return toApi(decided);
    });
  }

  async reject(request: RbacRequest, requestId: number, body: unknown) {
    const note = reqStr(asObject(body), 'decision_note', 500);
    await this.findScoped(request, requestId);
    return this.transactions.run(async (tx) => {
      await this.lockPending(tx, requestId);
      const decided = await tx.update('excuse_request', { request_id: requestId }, { status: 'REJECTED', decided_by: tx.actor.actorUserId, decided_at: new Date().toISOString(), decision_note: note });
      return toApi(decided);
    });
  }

  private async lockPending(tx: AuditedTx, requestId: number): Promise<Row> {
    const { rows } = await tx.query(`SELECT * FROM excuse_request WHERE request_id = $1 FOR UPDATE`, [requestId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    if (rows[0].status !== 'PENDING') throw conflict('INVALID_STATE_TRANSITION', '이미 처리된 신청입니다.');
    return rows[0];
  }

  // 존재 확인 + 스코프(강사는 본인 회차의 신청만). 범위 밖이면 존재를 숨긴다.
  private async findScoped(request: RbacRequest, requestId: number): Promise<Row> {
    const { rows } = await this.db.query(`SELECT * FROM excuse_request WHERE request_id = $1`, [requestId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    await this.scope.requireSchedule(request, Number(rows[0].schedule_id));
    return rows[0];
  }
}
