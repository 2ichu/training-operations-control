import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type pg from 'pg';
import { AuditedTransactionService } from '../audit/audited-transaction.js';
import { conflict } from '../common/tx.js';
import { toApi } from '../common/api.js';
import { asObject, type Obj, oneOf, qInt } from '../common/validation.js';
import { PG_POOL } from '../database/database.module.js';
import { type PermissionAction, type PermissionScope, SCREEN_ID_PATTERN } from '../rbac/rbac.types.js';

const ACTIONS: PermissionAction[] = ['C', 'R', 'U', 'D', 'A'];
const SCOPES: PermissionScope[] = ['ALL', 'OWN_ASSIGNED'];

interface Grant {
  screenId: string;
  action: PermissionAction;
  scope: PermissionScope;
}

// S26 권한 관리. role_permission 은 baseline 8절 예외로 hard delete 가 허용되는 "설정 데이터" —
// 전체 교체(DELETE 후 INSERT)를 허용하되 하나의 audit_log(UPDATE, before/after 배열)로 남긴다.
@Injectable()
export class RolePermissionService {
  constructor(
    @Inject(PG_POOL) private readonly db: pg.Pool,
    @Inject(AuditedTransactionService) private readonly transactions: AuditedTransactionService,
  ) {}

  async roles() {
    const { rows } = await this.db.query(`SELECT role_id, role_code, role_name FROM role ORDER BY role_id`);
    return { items: rows.map((r) => toApi(r)) };
  }

  async get(query: Obj) {
    const roleId = qInt(query, 'role_id');
    if (roleId === undefined) throw new BadRequestException({ code: 'VALIDATION', field: 'role_id', message: 'role_id 는 필수입니다' });
    const role = await this.findRole(roleId);
    const { rows } = await this.db.query(
      `SELECT screen_id, action, scope_type FROM role_permission WHERE role_id = $1 ORDER BY screen_id, action`,
      [roleId],
    );
    return { roleId, roleCode: role.role_code, items: rows.map((r) => toApi({ screen_id: r.screen_id, action: r.action, scope: r.scope_type })) };
  }

  async replace(roleId: number, body: unknown) {
    const role = await this.findRole(roleId);
    const grants = this.parseGrants(body);
    // 잠금 방지(기술적 안전장치): 시스템 관리자 역할에서 권한 화면(S26) 조회·저장을 빼면 누구도 권한을 되돌릴 수 없다
    if (role.role_code === 'SYS_ADMIN' && !(['R', 'U'] as const).every((a) => grants.some((g) => g.screenId === 'S26' && g.action === a))) {
      throw conflict('SELF_LOCKOUT', '시스템 관리자 역할에서 권한 관리(S26) 조회·저장 권한은 뺄 수 없습니다.');
    }

    return this.transactions.run(async (tx) => {
      const before = (await tx.query(`SELECT screen_id, action, scope_type FROM role_permission WHERE role_id = $1 ORDER BY screen_id, action`, [roleId])).rows;
      await tx.query(`DELETE FROM role_permission WHERE role_id = $1`, [roleId]);
      let after: pg.QueryResultRow[] = [];
      if (grants.length > 0) {
        const values = grants.map((_, i) => `($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`).join(', ');
        const params: unknown[] = [roleId];
        for (const g of grants) params.push(g.screenId, g.action, g.scope);
        after = (
          await tx.query(
            `INSERT INTO role_permission (role_id, screen_id, action, scope_type) VALUES ${values} RETURNING screen_id, action, scope_type`,
            params,
          )
        ).rows;
      }
      // 개별 행이 아니라 매트릭스 전체를 하나의 변경으로 감사에 남긴다(baseline 5-2: "저장 결과", before/after).
      await tx.query(
        `INSERT INTO audit_log (actor_type, actor_user_id, action, target_table, target_id, before_value, after_value, ip_address)
         VALUES ($1, $2, 'UPDATE', 'role_permission', $3, $4, $5, $6)`,
        [tx.actor.actorType, tx.actor.actorUserId, roleId, JSON.stringify(before), JSON.stringify(after), tx.actor.ip],
      );
      return { roleId, items: after.map((r) => toApi({ screen_id: r.screen_id, action: r.action, scope: r.scope_type })) };
    });
  }

  private parseGrants(body: unknown): Grant[] {
    const o = asObject(body);
    const items = o.items;
    if (!Array.isArray(items)) throw new BadRequestException({ code: 'VALIDATION', field: 'items', message: '배열이어야 합니다' });
    const seen = new Set<string>();
    return items.map((raw, i) => {
      const item = asObject(raw, `items[${i}]`);
      const screenId = item.screenId;
      if (typeof screenId !== 'string' || !SCREEN_ID_PATTERN.test(screenId)) {
        throw new BadRequestException({ code: 'VALIDATION', field: `items[${i}].screenId`, message: 'S01~S28 형식이어야 합니다' });
      }
      const action = oneOf(item.action, `items[${i}].action`, ACTIONS);
      const scope = item.scope === undefined ? 'ALL' : oneOf(item.scope, `items[${i}].scope`, SCOPES);
      const key = `${screenId}:${action}`;
      if (seen.has(key)) throw new BadRequestException({ code: 'VALIDATION', field: `items[${i}]`, message: `중복된 화면·기능: ${key}` });
      seen.add(key);
      return { screenId, action, scope };
    });
  }

  private async findRole(roleId: number): Promise<{ role_id: string; role_code: string }> {
    const { rows } = await this.db.query(`SELECT role_id, role_code FROM role WHERE role_id = $1`, [roleId]);
    if (rows.length === 0) throw new NotFoundException('대상을 찾을 수 없습니다.');
    return rows[0];
  }
}
