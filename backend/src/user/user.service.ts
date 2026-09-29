import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { generateTempPassword, hashPassword } from '../auth/password.js';
import { type AuditedTx, AuditedTransactionService, type Row } from '../audit/audited-transaction.js';
import { escapeLike, pageOf, toApi, Where } from '../common/api.js';
import { conflict } from '../common/tx.js';
import { asObject, type Obj, oneOf, optInt, optStr, qEnumList, qStr, reqStr } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
// D-18(확정): 역할은 4개 고정. 사용자 1명은 정확히 1개 역할을 가진다(현재 시드·화면 설계와 일치).
const ROLE_CODES = ['SYS_ADMIN', 'OPS_MANAGER', 'INSTRUCTOR', 'EXECUTIVE'] as const;
type RoleCode = (typeof ROLE_CODES)[number];

const COLUMNS = 'u.user_id, u.login_id, u.name, u.email, u.linked_instructor_id, u.status, u.must_change_password, u.created_at, u.updated_at';

// password_hash 는 어떤 응답에도 포함하지 않는다(감사로그의 redact 와 별개로 API 응답 자체에서도 제외 — create/update 는 전체 행을 돌려주므로 여기서 걷어낸다).
const present = (row: Row, roleCode: string | null) => {
  const { password_hash: _passwordHash, ...rest } = row;
  return toApi({ ...rest, role_code: roleCode });
};

// S25 사용자 관리(baseline 5-2). 초기·초기화 비밀번호는 시스템이 생성해 응답에 1회 노출하고(그 값은 어떤 로그에도 남기지 않음),
// user_account.must_change_password=true 로 최초 로그인 시 변경을 강제한다(baseline 10-2 #5, 변경 자체는 POST /auth/change-password).
@Injectable()
export class UserService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  async list(query: Obj) {
    const where = new Where();
    const name = qStr(query, 'name');
    if (name) where.add((p) => `u.name ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(name)}%`);
    const loginId = qStr(query, 'login_id');
    if (loginId) where.add((p) => `u.login_id ILIKE ${p} ESCAPE '\\'`, `%${escapeLike(loginId)}%`);
    const statuses = qEnumList(query, 'status', STATUSES);
    if (statuses) where.add((p) => `u.status = ANY(${p}::user_status[])`, statuses);
    const role = qStr(query, 'role');
    if (role) where.add((p) => `r.role_code = ${p}`, oneOf(role, 'role', ROLE_CODES));

    const page = pageOf(query);
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS}, r.role_code, count(*) OVER() AS total
         FROM user_account u
         LEFT JOIN user_role ur ON ur.user_id = u.user_id
         LEFT JOIN role r ON r.role_id = ur.role_id
        WHERE ${where.sql} ORDER BY u.user_id LIMIT ${page.size} OFFSET ${page.offset}`,
      where.params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map(({ total: _t, role_code, ...r }) => present(r, role_code)), page: page.page, size: page.size, total };
  }

  async detail(userId: number) {
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS}, r.role_code FROM user_account u
         LEFT JOIN user_role ur ON ur.user_id = u.user_id LEFT JOIN role r ON r.role_id = ur.role_id
        WHERE u.user_id = $1`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    return present(rows[0], rows[0].role_code);
  }

  create(body: unknown) {
    const o = asObject(body);
    const values = {
      login_id: reqStr(o, 'login_id', 50),
      name: reqStr(o, 'name', 50),
      email: optStr(o, 'email', 100) ?? null,
    };
    const role = oneOf(o.role, 'role', ROLE_CODES);
    const linkedInstructorId = this.resolveLinkedInstructorId(role, optInt(o, 'linked_instructor_id'), null);
    const tempPassword = generateTempPassword();

    return this.transactions.run(async (tx) => {
      const passwordHash = await hashPassword(tempPassword);
      const created = await tx.create('user_account', {
        ...values,
        password_hash: passwordHash,
        linked_instructor_id: linkedInstructorId,
        status: 'ACTIVE',
        must_change_password: true,
      });
      const roleId = await this.roleId(tx, role);
      await tx.create('user_role', { user_id: created.user_id, role_id: roleId });
      return { ...present(created, role), tempPassword };
    });
  }

  async update(userId: number, body: unknown) {
    const o = asObject(body);
    const set: Row = {};
    if (o.name !== undefined) set.name = reqStr(o, 'name', 50);
    if (o.email !== undefined) set.email = optStr(o, 'email', 100);
    if (o.status !== undefined) set.status = oneOf(o.status, 'status', STATUSES);

    const role = o.role === undefined ? undefined : oneOf(o.role, 'role', ROLE_CODES);
    const linkedProvided = o.linked_instructor_id !== undefined;
    if (Object.keys(set).length === 0 && role === undefined && !linkedProvided) {
      throw new BadRequestException({ code: 'VALIDATION', message: '변경할 필드가 없습니다' });
    }

    const currentRow = await this.db.query<{ linked_instructor_id: string | null; role_code: string | null }>(
      `SELECT ua.linked_instructor_id, r.role_code::text AS role_code
         FROM user_account ua LEFT JOIN user_role ur ON ur.user_id = ua.user_id LEFT JOIN role r ON r.role_id = ur.role_id
        WHERE ua.user_id = $1`,
      [userId],
    );
    if (currentRow.rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    const currentLinked = currentRow.rows[0].linked_instructor_id === null ? null : Number(currentRow.rows[0].linked_instructor_id);
    const currentRole = currentRow.rows[0].role_code as RoleCode | null;
    const targetRole = role ?? currentRole;

    if (role !== undefined || linkedProvided) {
      set.linked_instructor_id = this.resolveLinkedInstructorId(targetRole, linkedProvided ? optInt(o, 'linked_instructor_id') : undefined, currentLinked);
    }

    return this.transactions.run(async (tx) => {
      const current = await this.lockUser(tx, userId);
      // 잠금 방지(기술적 안전장치): 마지막 활성 시스템 관리자를 비활성화하거나 다른 역할로 바꾸면 사용자·권한을 관리할 사람이 없어진다
      const losesAdmin = currentRole === 'SYS_ADMIN' && current.status === 'ACTIVE' && (set.status === 'INACTIVE' || (role !== undefined && role !== 'SYS_ADMIN'));
      if (losesAdmin) {
        const { rows } = await tx.query(
          `SELECT count(*) AS n FROM user_account ua JOIN user_role ur ON ur.user_id = ua.user_id JOIN role r ON r.role_id = ur.role_id
            WHERE r.role_code = 'SYS_ADMIN' AND ua.status = 'ACTIVE' AND ua.user_id <> $1`,
          [userId],
        );
        if (Number(rows[0].n) === 0) throw conflict('LAST_ADMIN', '마지막 활성 시스템 관리자는 비활성화하거나 역할을 바꿀 수 없습니다.');
      }
      const updated = Object.keys(set).length > 0 ? await tx.update('user_account', { user_id: userId }, set) : current;
      if (role !== undefined && role !== currentRole) {
        await tx.query(`DELETE FROM user_role WHERE user_id = $1`, [userId]);
        const roleId = await this.roleId(tx, role);
        await tx.create('user_role', { user_id: userId, role_id: roleId });
      }
      return present(updated, targetRole);
    });
  }

  async resetPassword(userId: number) {
    const tempPassword = generateTempPassword();
    return this.transactions.run(async (tx) => {
      await this.lockUser(tx, userId);
      const passwordHash = await hashPassword(tempPassword);
      await tx.update('user_account', { user_id: userId }, { password_hash: passwordHash, must_change_password: true });
      return { tempPassword };
    });
  }

  // targetRole===INSTRUCTOR 면 linked_instructor_id 가 필요(요청값 우선, 없으면 기존값). 그 외 역할이면 항상 null 로 정규화한다.
  private resolveLinkedInstructorId(targetRole: RoleCode | null, provided: number | null | undefined, current: number | null): number | null {
    if (targetRole === 'INSTRUCTOR') {
      const value = provided !== undefined ? provided : current;
      if (value === null) throw new BadRequestException({ code: 'VALIDATION', field: 'linked_instructor_id', message: 'INSTRUCTOR 역할은 linked_instructor_id 가 필수입니다' });
      return value;
    }
    if (provided !== undefined && provided !== null) {
      throw new BadRequestException({ code: 'VALIDATION', field: 'linked_instructor_id', message: 'INSTRUCTOR 역할이 아니면 지정할 수 없습니다' });
    }
    return null;
  }

  private async roleId(tx: AuditedTx, roleCode: RoleCode): Promise<number> {
    const { rows } = await tx.query(`SELECT role_id FROM role WHERE role_code = $1`, [roleCode]);
    if (rows.length === 0) throw new BadRequestException({ code: 'ROLE_NOT_SEEDED', message: `역할이 시드되지 않았습니다: ${roleCode}` });
    return Number(rows[0].role_id);
  }

  private async lockUser(tx: AuditedTx, userId: number): Promise<Row> {
    const { rows } = await tx.query(`SELECT * FROM user_account WHERE user_id = $1 FOR UPDATE`, [userId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    return rows[0];
  }
}
