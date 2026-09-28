import 'dotenv/config';
import pg from 'pg';
import { DETECTION_RULES } from './detection-rules.js';
import { hashPassword } from './password-hash.js';
import { PHASE1_PERMISSIONS } from './permissions.js';
import { ROLES } from './roles.js';

// 시드는 멱등이다(이미 있으면 건너뜀). 모든 삽입은 audit_log 에 actor_type=SYSTEM_BATCH 로 남긴다.
// role_permission 개별 행의 감사는 권한 관리(S26) 구현 시 정식 흐름으로 대체한다(여기서는 역할별 요약 1건).

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`환경변수 ${name} 가 필요합니다 (.env.example 참고)`);
  return value;
}

async function audit(
  client: pg.Client,
  targetTable: string,
  targetId: number,
  after: unknown,
  reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_type, action, target_table, target_id, after_value, reason)
     VALUES ('SYSTEM_BATCH', 'CREATE', $1, $2, $3, $4)`,
    [targetTable, targetId, JSON.stringify(after), reason],
  );
}

async function seedRoles(client: pg.Client): Promise<Map<string, number>> {
  const roleIds = new Map<string, number>();
  for (const role of ROLES) {
    const inserted = await client.query<{ role_id: string }>(
      `INSERT INTO role (role_code, role_name) VALUES ($1, $2)
       ON CONFLICT (role_code) DO NOTHING RETURNING role_id`,
      [role.roleCode, role.roleName],
    );
    if (inserted.rowCount) {
      await audit(client, 'role', Number(inserted.rows[0].role_id), role, 'seed:roles');
    }
    const found = await client.query<{ role_id: string }>('SELECT role_id FROM role WHERE role_code = $1', [role.roleCode]);
    roleIds.set(role.roleCode, Number(found.rows[0].role_id));
  }
  return roleIds;
}

async function seedPermissions(client: pg.Client, roleIds: Map<string, number>): Promise<void> {
  const insertedPerRole = new Map<string, number>();
  for (const p of PHASE1_PERMISSIONS) {
    const roleId = roleIds.get(p.roleCode);
    if (roleId === undefined) throw new Error(`알 수 없는 역할: ${p.roleCode}`);
    const result = await client.query(
      `INSERT INTO role_permission (role_id, screen_id, action, scope_type) VALUES ($1, $2, $3, $4)
       ON CONFLICT (role_id, screen_id, action) DO NOTHING`,
      [roleId, p.screenId, p.action, p.scope],
    );
    if (result.rowCount) insertedPerRole.set(p.roleCode, (insertedPerRole.get(p.roleCode) ?? 0) + 1);
  }
  for (const [roleCode, count] of insertedPerRole) {
    await audit(client, 'role_permission', roleIds.get(roleCode)!, { roleCode, insertedRows: count }, 'seed:role-permissions');
  }
}

async function seedDetectionRules(client: pg.Client): Promise<void> {
  for (const rule of DETECTION_RULES) {
    const inserted = await client.query<{ rule_id: string }>(
      `INSERT INTO detection_rule (rule_code, rule_name, initial_status, params, description) VALUES ($1, $2, 'NEEDS_CHECK', $3, $4)
       ON CONFLICT (rule_code) DO NOTHING RETURNING rule_id`,
      [rule.ruleCode, rule.ruleName, JSON.stringify(rule.params), rule.description],
    );
    if (inserted.rowCount) await audit(client, 'detection_rule', Number(inserted.rows[0].rule_id), rule, 'seed:detection-rules');
  }
}

async function seedSysAdmin(client: pg.Client, sysAdminRoleId: number): Promise<void> {
  const loginId = requireEnv('SEED_ADMIN_LOGIN_ID');
  const password = requireEnv('SEED_ADMIN_PASSWORD');
  const name = requireEnv('SEED_ADMIN_NAME');

  const exists = await client.query('SELECT 1 FROM user_account WHERE login_id = $1', [loginId]);
  if (exists.rowCount) return;

  const inserted = await client.query<{ user_id: string }>(
    `INSERT INTO user_account (login_id, password_hash, name) VALUES ($1, $2, $3) RETURNING user_id`,
    [loginId, await hashPassword(password), name],
  );
  const userId = Number(inserted.rows[0].user_id);
  await client.query('INSERT INTO user_role (user_id, role_id) VALUES ($1, $2)', [userId, sysAdminRoleId]);
  // password_hash 는 로그에 남기지 않는다
  await audit(client, 'user_account', userId, { login_id: loginId, name, role: 'SYS_ADMIN' }, 'seed:initial-sys-admin');
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL') });
  await client.connect();
  try {
    await client.query('BEGIN');
    const roleIds = await seedRoles(client);
    await seedPermissions(client, roleIds);
    await seedDetectionRules(client);
    await seedSysAdmin(client, roleIds.get('SYS_ADMIN')!);
    await client.query('COMMIT');
    console.log('seed 완료');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
