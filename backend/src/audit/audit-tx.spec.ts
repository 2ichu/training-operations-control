import { defer, lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuditContext, AuditedTxError } from './audit-context.js';
import { AuditContextInterceptor } from './audit-context.interceptor.js';
import type { AuditEntry } from './audit-log.service.js';
import { AuditedTransactionService, sanitizeRow } from './audited-transaction.js';
import { AUDITABLE_TABLES, maskBirthDate, maskTail } from './audit-registry.js';

// ── 가짜 DB: 실행된 SQL 을 순서대로 기록하고 패턴별로 결과·실패를 주입한다 ─────────────────
interface Call {
  sql: string;
  params: unknown[];
}
function fakeDb(handlers: { match: RegExp; rows?: unknown[]; fail?: Error }[] = []) {
  const calls: Call[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const h = handlers.find((x) => x.match.test(sql));
      if (h?.fail) throw h.fail;
      return { rows: h?.rows ?? [] };
    }),
  };
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ ...client, release })) };
  const kinds = (): string[] =>
    calls.map((c) => {
      const s = c.sql.trim();
      if (/^SAVEPOINT|^RELEASE|^ROLLBACK TO/.test(s)) return s.split(' ').slice(0, 2).join(' ');
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return s.split(/\s/)[0];
      if (/^SELECT .* FOR UPDATE/s.test(s)) return 'SELECT FOR UPDATE';
      const m = s.match(/^(INSERT INTO|UPDATE)\s+"?(\w+)"?/);
      return m ? `${m[1]} ${m[2]}` : s.slice(0, 20);
    });
  return { calls, client, pool, release, kinds };
}

const USER = { actorType: 'USER' as const, actorUserId: 7, ip: '10.0.0.1' };
function harness(db: ReturnType<typeof fakeDb>, audits: AuditEntry[] = [], auditFail?: Error) {
  const ctx = new AuditContext();
  const audit = {
    record: vi.fn(async (entry: AuditEntry, dbArg?: { query: (...a: never[]) => unknown }) => {
      if (auditFail) throw auditFail;
      audits.push(entry);
      // 실제 구현처럼 전달받은 트랜잭션 클라이언트로 INSERT 를 수행(순서 검증용)
      await (dbArg as typeof db.client).query('INSERT INTO audit_log (…)', [entry.action]);
    }),
  };
  const service = new AuditedTransactionService(db.pool as never, ctx, audit as never);
  return { ctx, audit, service, audits };
}

const traineeRow = { trainee_id: '11', name: '김', birth_date: new Date('1990-03-05T00:00:00'), contact: '010-1234-5678' };

describe('AuditContext', () => {
  it('컨텍스트 밖에서는 require() 가 거부한다', () => {
    expect(() => new AuditContext().require()).toThrowError(AuditedTxError);
  });
  it('USER 는 actorUserId 필수, 시스템은 식별자 필수·actorUserId 금지', () => {
    const ctx = new AuditContext();
    expect(() => ctx.run({ actorType: 'USER', actorUserId: null, ip: null }, () => 1)).toThrow();
    expect(() => ctx.run({ actorType: 'SYSTEM_BATCH', actorUserId: null, ip: null }, () => 1)).toThrow();
    expect(() => ctx.run({ actorType: 'SYSTEM_RULE', actorUserId: 1, ip: null, systemTag: 'RULE_04' }, () => 1)).toThrow();
    expect(ctx.runAsSystem('SYSTEM_RULE', 'RULE_04', () => ctx.require())).toMatchObject({ actorType: 'SYSTEM_RULE', actorUserId: null, systemTag: 'RULE_04' });
  });
  it('비동기 처리 전체에서 컨텍스트가 유지되고 요청 간에 섞이지 않는다', async () => {
    const ctx = new AuditContext();
    const read = async (id: number) => ctx.run({ actorType: 'USER', actorUserId: id, ip: null }, async () => {
      await new Promise((r) => setTimeout(r, id === 1 ? 20 : 1));
      return ctx.require().actorUserId;
    });
    expect(await Promise.all([read(1), read(2)])).toEqual([1, 2]);
    expect(ctx.current()).toBeUndefined();
  });
});

describe('AuditContextInterceptor (행위자 자동 태깅)', () => {
  const exec = (session?: { userId: number }) => ({ switchToHttp: () => ({ getRequest: () => ({ authSession: session, ip: '1.2.3.4' }) }) }) as never;

  it('로그인 요청은 USER 로 태깅되어 핸들러 내부(비동기 포함)에서 조회된다', async () => {
    const ctx = new AuditContext();
    const interceptor = new AuditContextInterceptor(ctx);
    const handler = { handle: () => defer(async () => { await Promise.resolve(); return ctx.current(); }) };
    const seen = await lastValueFrom(interceptor.intercept(exec({ userId: 42 }), handler));
    expect(seen).toEqual({ actorType: 'USER', actorUserId: 42, ip: '1.2.3.4' });
    expect(ctx.current()).toBeUndefined(); // 요청 밖으로 새지 않음
  });
  it('세션이 없는 요청은 컨텍스트를 만들지 않는다', async () => {
    const ctx = new AuditContext();
    const seen = await lastValueFrom(new AuditContextInterceptor(ctx).intercept(exec(), { handle: () => of(ctx.current()) }));
    expect(seen).toBeUndefined();
  });
});

describe('AuditedTransactionService — 트랜잭션 일관성', () => {
  it('행위자 컨텍스트가 없으면 트랜잭션을 시작하지 않는다', async () => {
    const db = fakeDb();
    const { service } = harness(db);
    await expect(service.run(async () => 1)).rejects.toMatchObject({ code: 'ACTOR_REQUIRED' });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('create: BEGIN → INSERT → audit INSERT → COMMIT, 같은 연결에서 수행되고 연결을 반납한다', async () => {
    const db = fakeDb([{ match: /^INSERT INTO "course"/, rows: [{ course_id: '5', course_name: 'c' }] }]);
    const { ctx, service, audits } = harness(db);
    const row = await ctx.run(USER, () => service.run((tx) => tx.create('course', { course_name: 'c' }, { reason: '개설' })));
    expect(row).toMatchObject({ course_id: '5' });
    expect(db.kinds()).toEqual(['BEGIN', 'INSERT INTO course', 'INSERT INTO audit_log', 'COMMIT']);
    expect(db.release).toHaveBeenCalledTimes(1);
    expect(audits[0]).toMatchObject({ actorType: 'USER', actorUserId: 7, action: 'CREATE', targetTable: 'course', targetId: 5, reason: '개설', ip: '10.0.0.1', after: { course_id: '5' } });
    // 공통 감사컬럼은 행위자로 채워진다
    expect(db.calls[1].sql).toContain('"created_by"');
    expect(db.calls[1].params).toContain(7);
  });

  it('update(변경이력 대상): SELECT FOR UPDATE → UPDATE → change_log → audit → COMMIT 순서, 변경이력은 사유·행위자 포함', async () => {
    const after = { ...traineeRow, contact: '010-9999-0000' };
    const db = fakeDb([
      { match: /FOR UPDATE/, rows: [traineeRow] },
      { match: /^UPDATE "trainee"/, rows: [after] },
    ]);
    const { ctx, service, audits } = harness(db);
    await ctx.run(USER, () => service.run((tx) => tx.update('trainee', { trainee_id: 11 }, { contact: '010-9999-0000' }, { reason: '연락처 변경 요청' })));
    expect(db.kinds()).toEqual(['BEGIN', 'SELECT FOR UPDATE', 'UPDATE trainee', 'INSERT INTO trainee_change_log', 'INSERT INTO audit_log', 'COMMIT']);
    const log = db.calls.find((c) => c.sql.includes('trainee_change_log'))!;
    expect(log.params.slice(0, 3)).toEqual(['TRAINEE', 11, 7]);
    expect(log.params[5]).toBe('연락처 변경 요청');
    expect(audits[0]).toMatchObject({ action: 'UPDATE', targetId: 11, reason: '연락처 변경 요청' });
  });

  it('감사로그·변경이력에는 마스킹된 값만 남고 원문 개인정보는 없다', async () => {
    const after = { ...traineeRow, contact: '010-9999-0000' };
    const db = fakeDb([{ match: /FOR UPDATE/, rows: [traineeRow] }, { match: /^UPDATE "trainee"/, rows: [after] }]);
    const { ctx, service, audits } = harness(db);
    await ctx.run(USER, () => service.run((tx) => tx.update('trainee', { trainee_id: 11 }, { contact: '010-9999-0000' }, { reason: 'r' })));
    const serialized = JSON.stringify([audits, db.calls.filter((c) => c.sql.includes('change_log')).map((c) => c.params)]);
    for (const raw of ['010-1234-5678', '010-9999-0000', '1990-03-05', '5678-', '9999-']) expect(serialized).not.toContain(raw); // 원문 전체 값은 없고 마스킹 값(끝 4자리)만 있다
    expect(serialized).toContain('***-****-0000');
    expect(serialized).toContain('1990-**-**');
  });

  it('감사 기록 실패 → ROLLBACK, COMMIT 없음, 오류 전파(원본 변경 무효)', async () => {
    const db = fakeDb([{ match: /^INSERT INTO "course"/, rows: [{ course_id: '5' }] }]);
    const { ctx, service } = harness(db, [], new Error('audit down'));
    await expect(ctx.run(USER, () => service.run((tx) => tx.create('course', { course_name: 'c' })))).rejects.toThrow('audit down');
    expect(db.kinds()).toEqual(['BEGIN', 'INSERT INTO course', 'ROLLBACK']);
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it('변경이력 기록 실패 → 감사로그를 쓰기 전에 ROLLBACK', async () => {
    const db = fakeDb([
      { match: /FOR UPDATE/, rows: [traineeRow] },
      { match: /^UPDATE "trainee"/, rows: [traineeRow] },
      { match: /INTO trainee_change_log/, fail: new Error('change log down') },
    ]);
    const { ctx, service, audits } = harness(db);
    await expect(ctx.run(USER, () => service.run((tx) => tx.update('trainee', { trainee_id: 11 }, { name: 'x' }, { reason: 'r' })))).rejects.toThrow('change log down');
    expect(db.kinds()).toEqual(['BEGIN', 'SELECT FOR UPDATE', 'UPDATE trainee', 'INSERT INTO trainee_change_log', 'ROLLBACK']);
    expect(audits).toHaveLength(0);
  });

  it('원본 UPDATE 실패 → 변경이력·감사 모두 기록되지 않는다', async () => {
    const db = fakeDb([{ match: /FOR UPDATE/, rows: [traineeRow] }, { match: /^UPDATE "trainee"/, fail: new Error('constraint') }]);
    const { ctx, service, audits } = harness(db);
    await expect(ctx.run(USER, () => service.run((tx) => tx.update('trainee', { trainee_id: 11 }, { name: 'x' }, { reason: 'r' })))).rejects.toThrow('constraint');
    expect(db.kinds()).toEqual(['BEGIN', 'SELECT FOR UPDATE', 'UPDATE trainee', 'ROLLBACK']);
    expect(audits).toHaveLength(0);
  });

  it('COMMIT 실패도 오류로 전파되고 연결은 반납된다', async () => {
    const db = fakeDb([{ match: /^INSERT INTO "course"/, rows: [{ course_id: '5' }] }, { match: /^COMMIT/, fail: new Error('commit failed') }]);
    const { ctx, service } = harness(db);
    await expect(ctx.run(USER, () => service.run((tx) => tx.create('course', { course_name: 'c' })))).rejects.toThrow('commit failed');
    expect(db.release).toHaveBeenCalledTimes(1);
  });

  it('변경이력 대상 테이블은 사유가 없으면 어떤 쓰기도 하기 전에 거부한다', async () => {
    const db = fakeDb();
    const { ctx, service } = harness(db);
    await expect(ctx.run(USER, () => service.run((tx) => tx.update('trainee', { trainee_id: 11 }, { name: 'x' })))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(ctx.run(USER, () => service.run((tx) => tx.update('trainee', { trainee_id: 11 }, { name: 'x' }, { reason: '   ' })))).rejects.toMatchObject({ code: 'INVALID' });
    expect(db.kinds().filter((k) => k.startsWith('UPDATE') || k.startsWith('SELECT') || k.startsWith('INSERT'))).toEqual([]);
  });

  it('대상 행이 없으면 NOT_FOUND 로 롤백한다', async () => {
    const db = fakeDb([{ match: /FOR UPDATE/, rows: [] }]);
    const { ctx, service } = harness(db);
    await expect(ctx.run(USER, () => service.run((tx) => tx.update('course', { course_id: 1 }, { course_name: 'x' })))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.kinds()).toEqual(['BEGIN', 'SELECT FOR UPDATE', 'ROLLBACK']);
  });

  it('시스템 행위자: actor_type·식별자 사유가 기록되고 created_by/updated_by 는 NULL, 변경이력 대상 테이블은 거부', async () => {
    const db = fakeDb([{ match: /FOR UPDATE/, rows: [{ course_id: '3', status: 'PREPARING' }] }, { match: /^UPDATE "course"/, rows: [{ course_id: '3', status: 'IN_PROGRESS' }] }]);
    const { ctx, service, audits } = harness(db);
    await ctx.runAsSystem('SYSTEM_BATCH', 'batch:course-auto-start', () => service.run((tx) => tx.update('course', { course_id: 3 }, { status: 'IN_PROGRESS' })));
    expect(audits[0]).toMatchObject({ actorType: 'SYSTEM_BATCH', actorUserId: null, action: 'UPDATE', reason: 'batch:course-auto-start', ip: null });
    expect(db.calls.find((c) => c.sql.startsWith('UPDATE "course"'))!.params).toEqual([3, 'IN_PROGRESS', null]);

    const db2 = fakeDb();
    const h2 = harness(db2);
    await expect(h2.ctx.runAsSystem('SYSTEM_RULE', 'RULE_04', () => h2.service.run((tx) => tx.update('trainee', { trainee_id: 1 }, { name: 'x' }, { reason: 'r' })))).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('등록되지 않은 테이블·직접 지정 불가 컬럼·잘못된 식별자·불완전한 키를 거부한다', async () => {
    const db = fakeDb();
    const { ctx, service } = harness(db);
    const run = (fn: Parameters<typeof service.run>[0]) => ctx.run(USER, () => service.run(fn));
    await expect(run((tx) => tx.create('audit_log', { reason: 'x' }))).rejects.toMatchObject({ code: 'INVALID' }); // 로그 테이블은 이 경로로 쓸 수 없다
    await expect(run((tx) => tx.create('pg_user', {}))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(run((tx) => tx.create('__proto__', {}))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(run((tx) => tx.update('course', { course_id: 1 }, { updated_by: 999 }))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(run((tx) => tx.update('course', { course_id: 1 }, { course_id: 2 }))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(run((tx) => tx.create('course', { 'course_name"; DROP TABLE course; --': 'x' }))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(run((tx) => tx.update('role_permission', { role_id: 1 }, { scope_type: 'ALL' }))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(run((tx) => tx.update('course', { course_id: 1 }, {}))).rejects.toMatchObject({ code: 'INVALID' });
    expect(db.kinds().some((k) => k.startsWith('INSERT INTO course') || k.startsWith('UPDATE'))).toBe(false);
  });

  it('client 지정 시 SAVEPOINT 로 같은 원자성을 제공한다(성공: RELEASE, 실패: ROLLBACK TO)', async () => {
    const ok = fakeDb([{ match: /^INSERT INTO "course"/, rows: [{ course_id: '5' }] }]);
    const a = harness(ok);
    await a.ctx.run(USER, () => a.service.run((tx) => tx.create('course', { course_name: 'c' }), { client: ok.client as never }));
    expect(ok.kinds()).toEqual(['SAVEPOINT sp_audited_1', 'INSERT INTO course', 'INSERT INTO audit_log', 'RELEASE SAVEPOINT']);
    expect(ok.pool.connect).not.toHaveBeenCalled();

    const bad = fakeDb([{ match: /^INSERT INTO "course"/, rows: [{ course_id: '5' }] }]);
    const b = harness(bad, [], new Error('audit down'));
    await expect(b.ctx.run(USER, () => b.service.run((tx) => tx.create('course', { course_name: 'c' }), { client: bad.client as never }))).rejects.toThrow('audit down');
    expect(bad.kinds()).toEqual(['SAVEPOINT sp_audited_1', 'INSERT INTO course', 'ROLLBACK TO', 'RELEASE SAVEPOINT']);
  });
});

describe('마스킹·등록부', () => {
  it('연락처는 뒤 4자리만, 생년월일은 연도만, 비밀번호 해시는 값 제거', () => {
    expect(maskTail('010-1234-5678')).toBe('***-****-5678');
    expect(maskTail(null)).toBeNull();
    expect(maskBirthDate(new Date('1990-03-05T00:00:00'))).toBe('1990-**-**');
    expect(maskBirthDate('1985-12-31')).toBe('1985-**-**');
    expect(sanitizeRow(AUDITABLE_TABLES.user_account, { user_id: '1', password_hash: 'scrypt$secret' })).toEqual({ user_id: '1', password_hash: '[REDACTED]' });
  });
  it('전용 변경이력 대상은 훈련생·등록·강사·배정 4종이고 로그 테이블은 등록부에 없다', () => {
    const withLog = Object.entries(AUDITABLE_TABLES).filter(([, d]) => d.changeLog).map(([n]) => n).sort();
    expect(withLog).toEqual(['instructor', 'instructor_assignment', 'trainee', 'trainee_enrollment']);
    for (const t of ['audit_log', 'trainee_change_log', 'instructor_change_log']) expect(Object.hasOwn(AUDITABLE_TABLES, t)).toBe(false);
  });
});
