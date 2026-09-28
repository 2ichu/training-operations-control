import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { maskTail } from '../audit/audit-registry.js';
import { AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { escapeLike, pageOf, toApi, Where } from '../common/api.js';
import { lockRow } from '../common/tx.js';
import { asObject, type Obj, oneOf, optStr, qDate, qEnumList, qInt, qStr, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import type { AccessContext, RbacRequest } from '../rbac/rbac.types.js';
import { ScopeService } from '../rbac/scope.service.js';

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const ENTITY_TYPES = ['INSTRUCTOR', 'ASSIGNMENT'] as const;

// 강사 연락처는 응답에서 마스킹한다(원문 열람 정책은 미정 — 훈련생 연락처와 동일 기준을 적용)
const present = (row: Row) => toApi({ ...row, contact: maskTail(row.contact) });

@Injectable()
export class InstructorService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(ScopeService) private readonly scope: ScopeService,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  async list(access: AccessContext, query: Obj) {
    const where = new Where();
    // INSTRUCTOR 는 본인 정보만(ScopeService.canAccessInstructor 와 동일 기준을 쿼리 조건으로 표현)
    if (access.scope !== 'ALL') {
      if (access.instructorId === null) where.clauses.push('FALSE');
      else where.add((p) => `i.instructor_id = ${p}`, access.instructorId);
    }
    const name = qStr(query, 'name');
    if (name) where.add((p) => `i.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(name)}%`);
    const statuses = qEnumList(query, 'status', STATUSES);
    if (statuses) where.add((p) => `i.status = ANY(${p}::instructor_status[])`, statuses);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT i.instructor_id, i.name, i.contact, i.status, i.created_at, i.updated_at,
              (SELECT count(DISTINCT ia.course_id) FROM instructor_assignment ia WHERE ia.instructor_id = i.instructor_id AND ia.status = 'ASSIGNED') AS assigned_course_count,
              count(*) OVER() AS total
         FROM instructor i WHERE ${where.sql} ORDER BY i.instructor_id LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => present(r)), page: page.page, size: page.size, total };
  }

  async detail(request: RbacRequest, instructorId: number) {
    await this.scope.requireInstructor(request, instructorId);
    const { rows } = await this.db.query(
      `SELECT instructor_id, name, contact, status, created_at, updated_at FROM instructor WHERE instructor_id = $1`,
      [instructorId],
    );
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    // 연결 계정은 읽기 전용 정보(password_hash 등 제외)
    const account = await this.db.query(`SELECT user_id, login_id, name, status FROM user_account WHERE linked_instructor_id = $1`, [instructorId]);
    return { ...present(rows[0]), linkedAccount: account.rows[0] ? toApi(account.rows[0]) : null };
  }

  create(body: unknown) {
    const o = asObject(body);
    const values = {
      name: reqStr(o, 'name', 50),
      contact: optStr(o, 'contact', 50) ?? null,
      status: o.status === undefined ? 'ACTIVE' : oneOf(o.status, 'status', STATUSES),
    };
    return this.transactions.run(async (tx) => present(await tx.create('instructor', values)));
  }

  async update(request: RbacRequest, instructorId: number, body: unknown) {
    await this.scope.requireInstructor(request, instructorId);
    const o = asObject(body);
    const reason = reqStr(o, 'reason', 500); // V6·전용 변경이력 필수
    const set: Row = {};
    if (o.name !== undefined) set.name = reqStr(o, 'name', 50);
    if (o.contact !== undefined) set.contact = optStr(o, 'contact', 50);
    if (o.status !== undefined) set.status = oneOf(o.status, 'status', STATUSES);
    if (Object.keys(set).length === 0) throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });

    return this.transactions.run(async (tx) => {
      const current = await lockRow(tx, 'instructor', 'instructor_id', instructorId);
      const updated = await tx.update('instructor', { instructor_id: instructorId }, set, { reason });
      const result = present(updated);
      if (current.status === 'ACTIVE' && updated.status === 'INACTIVE') {
        // 비활동 전환 시 진행 중 배정 경고(차단하지 않음)
        const { rows } = await tx.query(
          `SELECT count(*) AS n FROM instructor_assignment ia JOIN course c ON c.course_id = ia.course_id
            WHERE ia.instructor_id = $1 AND ia.status = 'ASSIGNED' AND c.status NOT IN ('CLOSED', 'SUSPENDED')`,
          [instructorId],
        );
        return { ...result, warnings: { inProgressAssignmentCount: Number(rows[0].n) } };
      }
      return result;
    });
  }

  // S14 강사 변경이력
  async changeLogs(query: Obj) {
    const where = new Where();
    const instructorId = qInt(query, 'instructor_id');
    if (instructorId) {
      where.add((p) => `((l.entity_type = 'INSTRUCTOR' AND l.entity_id = ${p}) OR ia.instructor_id = ${p})`, instructorId);
    }
    const types = qEnumList(query, 'entity_type', ENTITY_TYPES);
    if (types) where.add((p) => `l.entity_type = ANY(${p}::instructor_change_entity[])`, types);
    const from = qDate(query, 'from');
    if (from) where.add((p) => `l.changed_at >= ${p}::date`, from);
    const to = qDate(query, 'to');
    if (to) where.add((p) => `l.changed_at < (${p}::date + 1)`, to);

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT l.log_id, l.entity_type, l.entity_id, l.changed_by, u.name AS changed_by_name, l.changed_at, l.before_value, l.after_value, l.reason,
              count(*) OVER() AS total
         FROM instructor_change_log l
         JOIN user_account u ON u.user_id = l.changed_by
         LEFT JOIN instructor_assignment ia ON l.entity_type = 'ASSIGNMENT' AND ia.assignment_id = l.entity_id
        WHERE ${where.sql} ORDER BY l.changed_at DESC, l.log_id DESC LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, ...r }) => toApi(r)), page: page.page, size: page.size, total };
  }
}
