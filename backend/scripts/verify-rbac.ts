// RBAC 실제 DB 검증: PermissionService/ScopeService 를 실제 role_permission·업무 테이블에 대해 실행한다.
// 모든 데이터는 BEGIN … ROLLBACK 안에서만 만들어지며(감사로그도 기록하지 않음) DB 에 남지 않는다.
import 'dotenv/config';
import pg from 'pg';
import { PermissionService } from '../src/rbac/permission.service.js';
import type { AccessContext, PermissionAction, PermissionScope } from '../src/rbac/rbac.types.js';
import { ScopeService } from '../src/rbac/scope.service.js';

const results: { ok: boolean; name: string; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string): void => {
  results.push({ ok, name, detail });
};

// baseline.md 4-2 (Phase 1 화면). 시드 파일과 독립적으로 기대값을 적어 시드·가드를 함께 검증한다. 표기: 기능 문자열, *=OWN_ASSIGNED
const EXPECTED: Record<string, Record<string, string>> = {
  SYS_ADMIN: { S01: 'R', S02: 'R', S03: 'R', S04: 'R', S05: 'RA', S06: 'R', S07: 'R', S08: 'R', S09: 'R', S10: 'R', S11: 'R', S12: 'R', S13: 'R', S14: 'R', S15: 'R', S16: 'RA', S17: 'R', S18: 'R', S19: 'R', S21: 'R', S22: 'R', S23: 'R', S24: 'R', S25: 'CRU', S26: 'RU', S27: 'R', S28: 'RU' },
  OPS_MANAGER: { S01: 'R', S02: 'RU', S03: 'R', S04: 'CRU', S05: 'RA', S06: 'R', S07: 'CRUA', S08: 'R', S09: 'RU', S10: 'R', S11: 'R', S12: 'CRU', S13: 'CRU', S14: 'R', S15: 'CR', S16: 'CRUA', S17: 'RU', S18: 'CRUA', S19: 'CRU', S21: 'CR', S22: 'RA', S23: 'RA', S24: 'R' },
  INSTRUCTOR: { S01: 'R*', S03: 'R*', S05: 'R*', S07: 'CRU*', S08: 'R*', S09: 'R*', S11: 'R*', S12: 'R*', S13: 'R*', S15: 'R*', S16: 'R*', S17: 'CRU*', S18: 'CR*', S19: 'R*' },
  EXECUTIVE: { S01: 'R', S02: 'R', S03: 'R', S04: 'R', S05: 'RA', S06: 'R', S07: 'R', S08: 'R', S09: 'R', S10: 'R', S11: 'R', S12: 'R', S13: 'R', S14: 'R', S15: 'R', S16: 'RA', S17: 'R', S18: 'RA', S19: 'R', S21: 'R', S22: 'RA', S23: 'RA', S24: 'R', S27: 'R' },
};
const ACTIONS: PermissionAction[] = ['C', 'R', 'U', 'D', 'A'];
const screens = Array.from({ length: 28 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const ids = async (sql: string, params: unknown[] = []): Promise<number[]> => (await client.query(sql, params)).rows.map((r) => Number(r.id));
const one = async (sql: string, params: unknown[] = []): Promise<number> => (await ids(sql, params))[0];

const permissions = new PermissionService(client);
const scopeService = new ScopeService(client, { record: async () => undefined } as never);

await client.query('BEGIN');
try {
  // 역할별 테스트 사용자 (강사 계정은 강사 I1 과 연결)
  const i1 = await one(`INSERT INTO instructor (name) VALUES ('I1') RETURNING instructor_id id`);
  const i2 = await one(`INSERT INTO instructor (name) VALUES ('I2') RETURNING instructor_id id`);
  const users: Record<string, number> = {};
  for (const role of Object.keys(EXPECTED)) {
    const linked = role === 'INSTRUCTOR' ? i1 : null;
    const userId = await one(`INSERT INTO user_account (login_id, password_hash, name, linked_instructor_id) VALUES ($1, 'x', 'x', $2) RETURNING user_id id`, [`rbac_${role}`, linked]);
    await client.query(`INSERT INTO user_role (user_id, role_id) SELECT $1, role_id FROM role WHERE role_code = $2`, [userId, role]);
    users[role] = userId;
  }

  // ── 1. 권한 매트릭스: 4개 역할 × 28개 화면 × 5개 기능을 가드가 쓰는 조회로 전수 확인 ─────────
  for (const [role, expected] of Object.entries(EXPECTED)) {
    const mismatches: string[] = [];
    let granted = 0;
    for (const screen of screens) {
      for (const action of ACTIONS) {
        const result = await permissions.lookup(users[role], screen, action);
        const spec = expected[screen] ?? '';
        const expectAllowed = spec.replace('*', '').includes(action);
        const expectScope: PermissionScope = spec.includes('*') ? 'OWN_ASSIGNED' : 'ALL';
        const actualAllowed = result.status === 'OK';
        if (actualAllowed) granted += 1;
        if (actualAllowed !== expectAllowed || (actualAllowed && result.status === 'OK' && result.scope !== expectScope)) {
          mismatches.push(`${screen}:${action} 기대 ${expectAllowed ? expectScope : '거부'} / 실제 ${actualAllowed && result.status === 'OK' ? result.scope : '거부'}`);
        }
      }
    }
    const total = Object.values(expected).reduce((n, s) => n + s.replace('*', '').length, 0);
    check(`${role}: 27화면×5기능 전수 일치 (허용 ${total}건, 그 외 전부 거부)`, mismatches.length === 0 && granted === total, mismatches.slice(0, 3).join('; '));
  }
  const ins = await permissions.lookup(users.INSTRUCTOR, 'S13', 'R');
  check('강사 조회: instructorId 와 역할이 함께 반환됨', ins.status === 'OK' && ins.instructorId === i1 && ins.roles.join() === 'INSTRUCTOR');
  await client.query(`UPDATE user_account SET status = 'INACTIVE' WHERE user_id = $1`, [users.OPS_MANAGER]);
  check('비활성 계정은 INACTIVE 로 판정(세션 종료 대상)', (await permissions.lookup(users.OPS_MANAGER, 'S03', 'R')).status === 'INACTIVE');
  check('존재하지 않는 사용자도 INACTIVE', (await permissions.lookup(999999999, 'S03', 'R')).status === 'INACTIVE');

  // ── 2. 강사 스코프: 실제 테이블 기준 ───────────────────────────────────────────────
  const admin = users.SYS_ADMIN;
  const mkCourse = (n: string): Promise<number> =>
    one(`INSERT INTO course (course_name, start_date, end_date, total_hours, training_site, manager_user_id) VALUES ($1, '2026-10-01', '2026-10-31', 10, 's', $2) RETURNING course_id id`, [n, admin]);
  const courseA = await mkCourse('A'); // I1 과정 전체 담당
  const courseB = await mkCourse('B'); // I2 회차 배정
  const courseC = await mkCourse('C'); // 배정 없음
  await client.query(`INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, NULL)`, [i1, courseA]);
  await client.query(`INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, 1)`, [i2, courseB]);
  await client.query(`INSERT INTO instructor_assignment (instructor_id, course_id, round_no, status) VALUES ($1, $2, 1, 'CANCELLED')`, [i1, courseC]);
  const mkSchedule = (course: number, round: number, instructor: number): Promise<number> =>
    one(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, $2, '2026-10-02', '09:00', '18:00', $3) RETURNING schedule_id id`, [course, round, instructor]);
  const sA1 = await mkSchedule(courseA, 1, i1); // I1 본인 회차
  const sA2 = await mkSchedule(courseA, 2, i2); // 같은 과정이지만 타 강사 회차
  const sB1 = await mkSchedule(courseB, 1, i2);
  const mkTrainee = async (name: string, course: number, status: string): Promise<number> => {
    const t = await one(`INSERT INTO trainee (name) VALUES ($1) RETURNING trainee_id id`, [name]);
    await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, $3)`, [t, course, status]);
    return t;
  };
  const tConfirmed = await mkTrainee('T-confirmed', courseA, 'CONFIRMED');
  const tApplied = await mkTrainee('T-applied', courseA, 'APPLIED');
  const tReviewing = await mkTrainee('T-reviewing', courseA, 'REVIEWING');
  const tCancelled = await mkTrainee('T-cancelled', courseA, 'CANCELLED');
  const tCompleted = await mkTrainee('T-completed', courseA, 'COMPLETED');
  const tOther = await mkTrainee('T-otherCourse', courseB, 'CONFIRMED');

  const own = (instructorId: number | null): AccessContext => ({ userId: users.INSTRUCTOR, roles: ['INSTRUCTOR'], instructorId, screenId: 'S13', action: 'R', scope: 'OWN_ASSIGNED' });
  const all: AccessContext = { ...own(null), userId: admin, roles: ['OPS_MANAGER'], scope: 'ALL' };

  check('과정: 본인 배정 과정만 접근', (await scopeService.canAccessCourse(own(i1), courseA)) && !(await scopeService.canAccessCourse(own(i1), courseB)) && !(await scopeService.canAccessCourse(own(i1), courseC)));
  check('과정: 취소된 배정(course C)은 접근 불가', !(await scopeService.canAccessCourse(own(i1), courseC)));
  check('과정: 회차 단위 배정만 있는 강사(I2)도 해당 과정 접근 가능', await scopeService.canAccessCourse(own(i2), courseB));
  check('회차: 본인 회차만 접근 (같은 과정의 타 강사 회차는 불가)', (await scopeService.canAccessSchedule(own(i1), sA1)) && !(await scopeService.canAccessSchedule(own(i1), sA2)) && !(await scopeService.canAccessSchedule(own(i1), sB1)));
  check('훈련생: 본인 배정 과정의 확정 이후 상태만 접근(확정·수료 O)', (await scopeService.canAccessTrainee(own(i1), tConfirmed)) && (await scopeService.canAccessTrainee(own(i1), tCompleted)));
  check('훈련생: 신청·서류확인중·취소 상태와 타 과정 훈련생은 접근 불가', !(await scopeService.canAccessTrainee(own(i1), tApplied)) && !(await scopeService.canAccessTrainee(own(i1), tReviewing)) && !(await scopeService.canAccessTrainee(own(i1), tCancelled)) && !(await scopeService.canAccessTrainee(own(i1), tOther)));
  check('강사 정보: 본인만', scopeService.canAccessInstructor(own(i1), i1) && !scopeService.canAccessInstructor(own(i1), i2));
  check('ALL 범위(운영담당자 등)는 전부 접근', (await scopeService.canAccessCourse(all, courseC)) && (await scopeService.canAccessTrainee(all, tApplied)) && scopeService.canAccessInstructor(all, i2));
  check('instructorId 없는 강사 컨텍스트는 전부 거부', !(await scopeService.canAccessCourse(own(null), courseA)) && !(await scopeService.canAccessSchedule(own(null), sA1)));

  // 목록 쿼리 조건(V4): 실제 SQL 로 결과 집합 확인
  const test = 'course_name IN (\'A\',\'B\',\'C\')';
  const cf = scopeService.courseScopeFilter(own(i1), 'c.course_id', 1);
  const courses = await ids(`SELECT c.course_id id FROM course c WHERE ${test} AND ${cf.sql} ORDER BY c.course_id`, cf.params);
  check('목록 쿼리(과정): 본인 배정 과정만 반환', JSON.stringify(courses) === JSON.stringify([courseA]), JSON.stringify(courses));
  const sf = scopeService.scheduleScopeFilter(own(i1), 'cs.instructor_id', 1);
  const schedules = await ids(`SELECT cs.schedule_id id FROM class_schedule cs WHERE cs.course_id IN ($2, $3) AND ${sf.sql} ORDER BY 1`, [...sf.params, courseA, courseB]);
  check('목록 쿼리(회차): 본인 회차만 반환', JSON.stringify(schedules) === JSON.stringify([sA1]), JSON.stringify(schedules));
  const tf = scopeService.traineeScopeFilter(own(i1), 't.trainee_id', 1);
  const trainees = await ids(`SELECT t.trainee_id id FROM trainee t WHERE t.name LIKE 'T-%' AND ${tf.sql} ORDER BY 1`, tf.params);
  check('목록 쿼리(훈련생): 본인 과정의 확정 이후 훈련생만 반환', JSON.stringify(trainees) === JSON.stringify([tConfirmed, tCompleted]), JSON.stringify(trainees));
  const af = scopeService.courseScopeFilter(all, 'c.course_id', 1);
  check('목록 쿼리(ALL): 전체 반환', (await ids(`SELECT c.course_id id FROM course c WHERE ${test} AND ${af.sql}`, af.params)).length === 3);
  const nf = scopeService.courseScopeFilter(own(null), 'c.course_id', 1);
  check('목록 쿼리(instructorId 없음): 0건', (await ids(`SELECT c.course_id id FROM course c WHERE ${test} AND ${nf.sql}`, nf.params)).length === 0);

  // 배정 취소 후 즉시 접근 상실
  await client.query(`UPDATE instructor_assignment SET status = 'CANCELLED' WHERE instructor_id = $1 AND course_id = $2`, [i1, courseA]);
  check('배정 취소 즉시 과정·훈련생 접근 상실', !(await scopeService.canAccessCourse(own(i1), courseA)) && !(await scopeService.canAccessTrainee(own(i1), tConfirmed)));
} finally {
  await client.query('ROLLBACK');
}

const leftover = Number((await client.query(`SELECT count(*)::int n FROM user_account WHERE login_id LIKE 'rbac_%'`)).rows[0].n);
check('검증 데이터가 롤백되어 남지 않음', leftover === 0);
await client.end();

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과${failed.length ? `, 실패 ${failed.length}건` : ''}`);
process.exit(failed.length ? 1 : 0);
