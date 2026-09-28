import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../database/database.module.js';
import type { PermissionAction, PermissionScope, Queryable } from './rbac.types.js';

export type AccessLookup =
  | { status: 'INACTIVE' } // 계정이 없거나 비활성 → 세션 종료 대상(401)
  | { status: 'NO_PERMISSION'; roles: string[]; instructorId: number | null }
  | { status: 'OK'; roles: string[]; instructorId: number | null; scope: PermissionScope };

// 여러 역할이 같은 화면×기능을 부여하면 더 넓은 범위(ALL)가 우선한다.
export function mergeScopes(scopes: PermissionScope[]): PermissionScope | null {
  if (scopes.length === 0) return null;
  return scopes.includes('ALL') ? 'ALL' : 'OWN_ASSIGNED';
}

// 권한은 매 요청마다 DB(role_permission)에서 읽는다. 세션에 캐시하지 않으므로 권한·역할 변경과 계정 비활성화가 즉시 반영된다.
@Injectable()
export class PermissionService {
  constructor(@Inject(PG_POOL) private readonly db: pg.Pool | Queryable) {}

  async lookup(userId: number, screenId: string, action: PermissionAction): Promise<AccessLookup> {
    const user = await this.db.query<{ status: string; linked_instructor_id: string | null; roles: string[] | null }>(
      `SELECT u.status::text AS status, u.linked_instructor_id,
              (SELECT array_agg(r.role_code::text ORDER BY r.role_code)
                 FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id) AS roles
         FROM user_account u WHERE u.user_id = $1`,
      [userId],
    );
    const row = user.rows[0];
    if (!row || row.status !== 'ACTIVE') return { status: 'INACTIVE' };

    const roles = row.roles ?? [];
    const instructorId = row.linked_instructor_id === null ? null : Number(row.linked_instructor_id);

    const grants = await this.db.query<{ scope_type: PermissionScope }>(
      `SELECT rp.scope_type::text AS scope_type
         FROM role_permission rp JOIN user_role ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = $1 AND rp.screen_id = $2 AND rp.action = $3`,
      [userId, screenId, action],
    );
    const scope = mergeScopes(grants.rows.map((g) => g.scope_type));
    return scope ? { status: 'OK', roles, instructorId, scope } : { status: 'NO_PERMISSION', roles, instructorId };
  }
}
