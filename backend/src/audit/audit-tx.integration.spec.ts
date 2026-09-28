import 'dotenv/config';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditContext } from './audit-context.js';
import { AuditLogService } from './audit-log.service.js';
import { AuditedTransactionService } from './audited-transaction.js';

// 실제 PostgreSQL 통합 테스트(DATABASE_URL 필요, 없으면 건너뜀).
// 각 테스트는 바깥 트랜잭션(BEGIN … ROLLBACK) 안에서 실행되며, AuditedTransactionService 는 SAVEPOINT 로 동일한 원자성을 제공한다.
// 따라서 감사로그(append-only)를 포함해 어떤 데이터도 DB 에 남지 않는다. 실제 COMMIT 경로는 scripts/verify-audit-tx.ts 가 검증한다.
describe.skipIf(!process.env.DATABASE_URL)('감사·변경이력 트랜잭션 일관성 (실제 DB)', () => {
  let pool: pg.Pool;
  let db: pg.Client;
  let ctx: AuditContext;
  let audit: AuditLogService;
  let actorId: number;

  const service = (auditOverride?: Pick<AuditLogService, 'record'>) => new AuditedTransactionService(pool, ctx, auditOverride ?? audit);
  const asUser = <T>(fn: () => Promise<T>): Promise<T> => ctx.run({ actorType: 'USER', actorUserId: actorId, ip: '10.9.8.7' }, fn);
  // 지정한 SQL 이 실행되려 하면 실패하는 클라이언트(장애 주입)
  const failingOn = (pattern: RegExp) => ({ query: (sql: string, params?: unknown[]) => (pattern.test(sql) ? Promise.reject(new Error(`injected failure: ${pattern}`)) : db.query(sql, params)) }) as never;
  const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await db.query(sql, params)).rows[0].n);
  const auditRows = async (since: number) => (await db.query(`SELECT * FROM audit_log WHERE log_id > $1 ORDER BY log_id`, [since])).rows;
  const maxAuditId = async (): Promise<number> => count('SELECT coalesce(max(log_id), 0) n FROM audit_log');

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    audit = new AuditLogService(pool);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query('BEGIN');
    ctx = new AuditContext();
    actorId = Number((await db.query(`INSERT INTO user_account (login_id, password_hash, name) VALUES ('audit_it_actor', 'x', 'x') RETURNING user_id`)).rows[0].user_id);
  });
  afterEach(async () => {
    await db.query('ROLLBACK');
    await db.end();
  });

  it('생성: 원본 행과 audit_log(CREATE)가 함께 기록되고 행위자·IP·created_by 가 채워진다, 개인정보는 마스킹', async () => {
    const since = await maxAuditId();
    const row = await asUser(() =>
      service().run((tx) => tx.create('trainee', { name: '홍길동', birth_date: '1990-03-05', contact: '010-1234-5678' }, { reason: '신규 등록' }), { client: db }),
    );
    expect(row.created_by).toBe(String(actorId));
    const logs = await auditRows(since);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor_type: 'USER', actor_user_id: String(actorId), action: 'CREATE', target_table: 'trainee', target_id: String(row.trainee_id), reason: '신규 등록', ip_address: '10.9.8.7', before_value: null });
    expect(logs[0].after_value).toMatchObject({ name: '홍길동', contact: '***-****-5678', birth_date: '1990-**-**' });
    expect(JSON.stringify(logs[0])).not.toContain('010-1234-5678');
  });

  it('수정: 원본 UPDATE + trainee_change_log + audit_log(UPDATE)가 같은 트랜잭션에서 정확히 1건씩 기록된다', async () => {
    const trainee = await asUser(() => service().run((tx) => tx.create('trainee', { name: '홍길동', contact: '010-1111-2222' }), { client: db }));
    const since = await maxAuditId();
    const logsBefore = await count(`SELECT count(*) n FROM trainee_change_log WHERE entity_id = $1`, [trainee.trainee_id]);
    await asUser(() => service().run((tx) => tx.update('trainee', { trainee_id: trainee.trainee_id }, { contact: '010-3333-4444' }, { reason: '연락처 변경 요청' }), { client: db }));

    const current = (await db.query(`SELECT contact, updated_by FROM trainee WHERE trainee_id = $1`, [trainee.trainee_id])).rows[0];
    expect(current).toEqual({ contact: '010-3333-4444', updated_by: String(actorId) }); // 원본에는 실제 값
    const changeLogs = (await db.query(`SELECT * FROM trainee_change_log WHERE entity_id = $1 ORDER BY log_id`, [trainee.trainee_id])).rows;
    expect(changeLogs).toHaveLength(logsBefore + 1);
    expect(changeLogs.at(-1)).toMatchObject({ entity_type: 'TRAINEE', changed_by: String(actorId), reason: '연락처 변경 요청' });
    expect(changeLogs.at(-1).before_value.contact).toBe('***-****-2222');
    expect(changeLogs.at(-1).after_value.contact).toBe('***-****-4444');
    const logs = await auditRows(since);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'UPDATE', target_table: 'trainee', reason: '연락처 변경 요청' });
    expect(logs[0].before_value.contact).toBe('***-****-2222');
    expect(logs[0].after_value.contact).toBe('***-****-4444');
    for (const text of [JSON.stringify(logs[0]), JSON.stringify(changeLogs.at(-1))]) {
      expect(text).not.toContain('010-1111-2222');
      expect(text).not.toContain('010-3333-4444');
    }
  });

  it('감사로그 기록 실패 → 원본 변경·변경이력이 모두 롤백된다', async () => {
    const trainee = await asUser(() => service().run((tx) => tx.create('trainee', { name: '원래이름' }), { client: db }));
    const since = await maxAuditId();
    const changeLogsBefore = await count(`SELECT count(*) n FROM trainee_change_log`);

    await expect(
      asUser(() => service().run((tx) => tx.update('trainee', { trainee_id: trainee.trainee_id }, { name: '바뀐이름' }, { reason: 'r' }), { client: failingOn(/INSERT INTO audit_log/) })),
    ).rejects.toThrow('injected failure');

    expect((await db.query(`SELECT name FROM trainee WHERE trainee_id = $1`, [trainee.trainee_id])).rows[0].name).toBe('원래이름');
    expect(await count(`SELECT count(*) n FROM trainee_change_log`)).toBe(changeLogsBefore);
    expect(await auditRows(since)).toHaveLength(0);
  });

  it('변경이력 기록 실패 → 원본 변경이 롤백되고 감사로그도 남지 않는다', async () => {
    const trainee = await asUser(() => service().run((tx) => tx.create('trainee', { name: '원래이름' }), { client: db }));
    const since = await maxAuditId();
    await expect(
      asUser(() => service().run((tx) => tx.update('trainee', { trainee_id: trainee.trainee_id }, { name: '바뀐이름' }, { reason: 'r' }), { client: failingOn(/INSERT INTO trainee_change_log/) })),
    ).rejects.toThrow('injected failure');
    expect((await db.query(`SELECT name FROM trainee WHERE trainee_id = $1`, [trainee.trainee_id])).rows[0].name).toBe('원래이름');
    expect(await auditRows(since)).toHaveLength(0);
  });

  it('생성도 감사 실패 시 롤백된다(원본 행이 남지 않음)', async () => {
    const since = await maxAuditId();
    await expect(asUser(() => service().run((tx) => tx.create('trainee', { name: '유령' }), { client: failingOn(/INSERT INTO audit_log/) }))).rejects.toThrow('injected failure');
    expect(await count(`SELECT count(*) n FROM trainee WHERE name = '유령'`)).toBe(0);
    expect(await auditRows(since)).toHaveLength(0);
  });

  it('사유 없는 변경이력 대상 수정은 DB 에 아무것도 쓰지 않고 거부된다', async () => {
    const trainee = await asUser(() => service().run((tx) => tx.create('trainee', { name: '원래이름' }), { client: db }));
    const since = await maxAuditId();
    await expect(asUser(() => service().run((tx) => tx.update('trainee', { trainee_id: trainee.trainee_id }, { name: 'x' }), { client: db }))).rejects.toMatchObject({ code: 'INVALID' });
    expect((await db.query(`SELECT name, updated_at, created_at FROM trainee WHERE trainee_id = $1`, [trainee.trainee_id])).rows[0].name).toBe('원래이름');
    expect(await auditRows(since)).toHaveLength(0);
  });

  it('변경이력 대상 4종(훈련생·등록·강사·배정)이 각각 올바른 entity_type 으로 기록된다', async () => {
    const course = await asUser(() => service().run((tx) => tx.create('course', { course_name: 'c', start_date: '2026-10-01', end_date: '2026-10-31', total_hours: 10, training_site: 's', manager_user_id: actorId }), { client: db }));
    const trainee = await asUser(() => service().run((tx) => tx.create('trainee', { name: 't' }), { client: db }));
    const enrollment = await asUser(() => service().run((tx) => tx.create('trainee_enrollment', { trainee_id: trainee.trainee_id, course_id: course.course_id }), { client: db }));
    const instructor = await asUser(() => service().run((tx) => tx.create('instructor', { name: 'i', contact: '010-5555-6666' }), { client: db }));
    const assignment = await asUser(() => service().run((tx) => tx.create('instructor_assignment', { instructor_id: instructor.instructor_id, course_id: course.course_id }), { client: db }));

    const cases: [string, Record<string, unknown>, Record<string, unknown>, string, string][] = [
      ['trainee_enrollment', { enrollment_id: enrollment.enrollment_id }, { status: 'REVIEWING' }, 'trainee_change_log', 'ENROLLMENT'],
      ['instructor', { instructor_id: instructor.instructor_id }, { contact: '010-7777-8888' }, 'instructor_change_log', 'INSTRUCTOR'],
      ['instructor_assignment', { assignment_id: assignment.assignment_id }, { status: 'CANCELLED' }, 'instructor_change_log', 'ASSIGNMENT'],
    ];
    for (const [table, key, set, logTable, entityType] of cases) {
      await asUser(() => service().run((tx) => tx.update(table, key, set, { reason: `${table} 변경` }), { client: db }));
      const last = (await db.query(`SELECT entity_type, changed_by, reason FROM ${logTable} WHERE entity_type = $1 ORDER BY log_id DESC LIMIT 1`, [entityType])).rows[0];
      expect(last).toEqual({ entity_type: entityType, changed_by: String(actorId), reason: `${table} 변경` });
    }
  });

  it('시스템 행위자: audit_log 에 actor_type·식별자가 남고 actor_user_id/created_by/updated_by 는 NULL', async () => {
    const course = await asUser(() => service().run((tx) => tx.create('course', { course_name: 'sys', start_date: '2026-10-01', end_date: '2026-10-31', total_hours: 10, training_site: 's', manager_user_id: actorId }), { client: db }));
    const since = await maxAuditId();
    await ctx.runAsSystem('SYSTEM_BATCH', 'batch:course-auto-start', () => service().run((tx) => tx.update('course', { course_id: course.course_id }, { status: 'IN_PROGRESS' }), { client: db }));
    const logs = await auditRows(since);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actor_type: 'SYSTEM_BATCH', actor_user_id: null, action: 'UPDATE', reason: 'batch:course-auto-start', ip_address: null });
    expect(logs[0].before_value.status).toBe('PREPARING');
    expect(logs[0].after_value.status).toBe('IN_PROGRESS');
    expect((await db.query(`SELECT updated_by FROM course WHERE course_id = $1`, [course.course_id])).rows[0].updated_by).toBeNull();
  });

  it('계정 수정 감사에는 비밀번호 해시가 남지 않는다', async () => {
    const since = await maxAuditId();
    await asUser(() => service().run((tx) => tx.update('user_account', { user_id: actorId }, { password_hash: 'scrypt$super-secret-hash' }, { reason: '비밀번호 초기화' }), { client: db }));
    const [log] = await auditRows(since);
    expect(log.before_value.password_hash).toBe('[REDACTED]');
    expect(log.after_value.password_hash).toBe('[REDACTED]');
    expect(JSON.stringify(log)).not.toContain('super-secret-hash');
  });

  it('행 잠금: 동일 행의 before 값은 UPDATE 직전 값과 일치한다(연속 수정 시 before/after 체인)', async () => {
    const trainee = await asUser(() => service().run((tx) => tx.create('trainee', { name: 'v1' }), { client: db }));
    const since = await maxAuditId();
    for (const name of ['v2', 'v3']) await asUser(() => service().run((tx) => tx.update('trainee', { trainee_id: trainee.trainee_id }, { name }, { reason: 'r' }), { client: db }));
    const logs = await auditRows(since);
    expect(logs.map((l) => [l.before_value.name, l.after_value.name])).toEqual([['v1', 'v2'], ['v2', 'v3']]);
  });

  it('존재하지 않는 대상 수정은 NOT_FOUND 이고 아무것도 기록되지 않는다', async () => {
    const since = await maxAuditId();
    await expect(asUser(() => service().run((tx) => tx.update('course', { course_id: 999999999 }, { course_name: 'x' }), { client: db }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await auditRows(since)).toHaveLength(0);
  });

  it('audit_log 는 이 경로로 쓸 수 없고 DB 의 append-only 트리거는 계속 유효하다', async () => {
    await expect(asUser(() => service().run((tx) => tx.create('audit_log', { reason: 'x' }), { client: db }))).rejects.toMatchObject({ code: 'INVALID' });
    await db.query('SAVEPOINT sp');
    await expect(db.query(`UPDATE audit_log SET reason = 'tamper' WHERE log_id = (SELECT max(log_id) FROM audit_log)`)).rejects.toMatchObject({ code: '23001' });
    await db.query('ROLLBACK TO SAVEPOINT sp');
  });
});
