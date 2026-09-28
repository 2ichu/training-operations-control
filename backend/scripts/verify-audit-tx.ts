// 실제 COMMIT 경로 검증: 서비스가 커밋한 결과를 "다른 DB 연결"에서 관찰해 원본 변경·변경이력·감사로그의 원자성을 확인한다.
// 성공 경로는 실제로 커밋되므로 append-only 테이블에 행이 영구히 남는다(감사 4건 + 변경이력 1건, reason='verify:audit-tx').
// 업무 테이블(course, trainee)의 검증 행은 마지막에 소유자 권한으로 삭제한다. 실패 주입 경로는 아무것도 남지 않는다.
import 'dotenv/config';
import pg from 'pg';
import { AuditContext } from '../src/audit/audit-context.js';
import { AuditLogService } from '../src/audit/audit-log.service.js';
import { AuditedTransactionService } from '../src/audit/audited-transaction.js';

const results: { ok: boolean; name: string; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string): void => {
  results.push({ ok, name, detail });
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const observer = new pg.Client({ connectionString: process.env.DATABASE_URL }); // 서비스와 별개의 연결
await observer.connect();
const val = async (sql: string, params: unknown[] = []): Promise<any> => (await observer.query(sql, params)).rows[0]?.v;

const ctx = new AuditContext();
const audit = new AuditLogService(pool);
const service = new AuditedTransactionService(pool, ctx, audit);
// 실패 주입: 풀에서 받은 연결이 특정 SQL 을 실행하려는 순간 오류를 낸다
const failingService = (pattern: RegExp) =>
  new AuditedTransactionService(
    { connect: async () => { const c = await pool.connect(); return { query: (sql: string, p?: unknown[]) => (pattern.test(sql) ? Promise.reject(new Error('injected')) : c.query(sql, p)), release: () => c.release() }; } } as never,
    ctx,
    audit,
  );

const admin = Number(await val(`SELECT user_id v FROM user_account WHERE login_id = $1`, [process.env.SEED_ADMIN_LOGIN_ID]));
const asAdmin = <T>(fn: () => Promise<T>): Promise<T> => ctx.run({ actorType: 'USER', actorUserId: admin, ip: '127.0.0.1' }, fn);
const auditCount = (): Promise<number> => val(`SELECT count(*)::int v FROM audit_log`).then(Number);
const REASON = 'verify:audit-tx';

let courseId = 0;
let traineeId = 0;
try {
  // 1. 커밋 성공: 원본 + 감사가 다른 연결에서 함께 보인다
  const a0 = await auditCount();
  const course = await asAdmin(() =>
    service.run((tx) => tx.create('course', { course_name: 'verify-audit-tx', start_date: '2026-10-01', end_date: '2026-10-31', total_hours: 1, training_site: 's', manager_user_id: admin }, { reason: REASON })),
  );
  courseId = Number(course.course_id);
  check('커밋: 다른 연결에서 원본 행이 보임', (await val(`SELECT count(*)::int v FROM course WHERE course_id = $1`, [courseId])) === 1);
  check('커밋: 감사로그(CREATE)가 정확히 1건 함께 커밋됨', (await auditCount()) === a0 + 1 && (await val(`SELECT count(*)::int v FROM audit_log WHERE action='CREATE' AND target_table='course' AND target_id=$1 AND reason=$2 AND actor_user_id=$3`, [courseId, REASON, admin])) === 1);

  // 2. 감사 실패 주입: 원본 UPDATE 가 커밋되지 않는다
  const a1 = await auditCount();
  await asAdmin(() => failingService(/INSERT INTO audit_log/).run((tx) => tx.update('course', { course_id: courseId }, { course_name: 'should-not-persist' }, { reason: REASON }))).then(
    () => check('감사 실패 주입 시 오류가 전파됨', false, '오류 없음'),
    () => check('감사 실패 주입 시 오류가 전파됨', true),
  );
  check('감사 실패: 다른 연결에서 원본이 변경되지 않았고 감사 행도 없음', (await val(`SELECT course_name v FROM course WHERE course_id = $1`, [courseId])) === 'verify-audit-tx' && (await auditCount()) === a1);

  // 3. 커밋 성공(수정): 원본 + 감사(before/after)
  await asAdmin(() => service.run((tx) => tx.update('course', { course_id: courseId }, { course_name: 'verify-audit-tx-2' }, { reason: REASON })));
  check('수정 커밋: 원본 변경이 다른 연결에서 보임', (await val(`SELECT course_name v FROM course WHERE course_id = $1`, [courseId])) === 'verify-audit-tx-2');
  const upd = (await observer.query(`SELECT before_value, after_value, actor_type::text FROM audit_log WHERE action='UPDATE' AND target_table='course' AND target_id=$1 AND reason=$2`, [courseId, REASON])).rows;
  check('수정 커밋: 감사에 before/after 가 정확히 1건 기록됨', upd.length === 1 && upd[0].before_value.course_name === 'verify-audit-tx' && upd[0].after_value.course_name === 'verify-audit-tx-2' && upd[0].actor_type === 'USER');

  // 4. 훈련생: 원본 + 변경이력 + 감사가 한 트랜잭션으로 커밋 / 변경이력 실패 시 전부 롤백
  const trainee = await asAdmin(() => service.run((tx) => tx.create('trainee', { name: 'verify-audit-tx', contact: '010-1234-5678' }, { reason: REASON })));
  traineeId = Number(trainee.trainee_id);
  const logsBefore = await val(`SELECT count(*)::int v FROM trainee_change_log WHERE entity_id = $1`, [traineeId]);
  const a2 = await auditCount();
  await asAdmin(() => failingService(/INSERT INTO trainee_change_log/).run((tx) => tx.update('trainee', { trainee_id: traineeId }, { contact: '010-9999-0000' }, { reason: REASON }))).then(
    () => check('변경이력 실패 주입 시 오류가 전파됨', false, '오류 없음'),
    () => check('변경이력 실패 주입 시 오류가 전파됨', true),
  );
  check('변경이력 실패: 원본·변경이력·감사 모두 그대로', (await val(`SELECT contact v FROM trainee WHERE trainee_id = $1`, [traineeId])) === '010-1234-5678' && (await val(`SELECT count(*)::int v FROM trainee_change_log WHERE entity_id = $1`, [traineeId])) === logsBefore && (await auditCount()) === a2);

  await asAdmin(() => service.run((tx) => tx.update('trainee', { trainee_id: traineeId }, { contact: '010-9999-0000' }, { reason: REASON })));
  check('훈련생 수정 커밋: 원본에는 실제 값', (await val(`SELECT contact v FROM trainee WHERE trainee_id = $1`, [traineeId])) === '010-9999-0000');
  const logs = (await observer.query(`SELECT changed_by, reason, before_value, after_value FROM trainee_change_log WHERE entity_type='TRAINEE' AND entity_id=$1 AND reason=$2`, [traineeId, REASON])).rows;
  check('훈련생 수정 커밋: 변경이력 1건(행위자·사유·마스킹 값)', logs.length === 1 && Number(logs[0].changed_by) === admin && logs[0].before_value.contact === '***-****-5678' && logs[0].after_value.contact === '***-****-0000');
  check('훈련생 수정 커밋: 감사로그도 같은 시점에 1건, 원문 연락처 미포함', (await val(`SELECT count(*)::int v FROM audit_log WHERE action='UPDATE' AND target_table='trainee' AND target_id=$1 AND reason=$2`, [traineeId, REASON])) === 1 && (await val(`SELECT count(*)::int v FROM audit_log WHERE (before_value::text LIKE '%010-1234-5678%' OR after_value::text LIKE '%010-9999-0000%')`)) === 0);
} finally {
  // 업무 테이블의 검증 행 정리(로그 테이블은 append-only 이므로 남는다)
  if (traineeId) await observer.query(`DELETE FROM trainee WHERE trainee_id = $1`, [traineeId]);
  if (courseId) await observer.query(`DELETE FROM course WHERE course_id = $1`, [courseId]);
  await observer.end();
  await pool.end();
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
