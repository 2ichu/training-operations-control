import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { hashPassword } from '../src/auth/password.js';
import { CourseService } from '../src/course/course.service.js';
import { PG_POOL } from '../src/database/database.module.js';
import { DetectionRuleService } from '../src/verification/detection-rule.service.js';
import { RollbackPool } from './support/rollback-pool.js';

// 과정·훈련생·강사·일정 API 의 실제 DB HTTP 통합 테스트 (DATABASE_URL 필요, 없으면 건너뜀).
// 하나의 바깥 트랜잭션 위에서 실행되고 항상 ROLLBACK 되므로 DB 에 데이터·감사로그가 남지 않는다(RollbackPool).
// 사전 조건: migrate:up + db:seed 가 실행되어 역할·권한 시드가 있어야 한다.
describe.skipIf(!process.env.DATABASE_URL)('도메인 API (실제 DB, HTTP)', () => {
  const PASSWORD = 'Test-only-passw0rd!';
  let passwordHash: string;
  let app: INestApplication;
  let client: pg.Client;
  let pool: RollbackPool;
  let detection: DetectionRuleService;

  // 테스트 데이터 ID
  let sys: number, ops: number, exec: number, insUser1: number, insUser2: number;
  let i1: number, i2: number; // 강사
  let c1: number, c2: number; // 과정 (c1: 강사1 배정, c2: 강사2 배정)
  let s1: number, s2: number; // 회차 (s1: c1/강사1, s2: c2/강사2)
  let tConfirmed1: number, tApplied1: number, tConfirmed2: number;

  const rows = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  const num = async (sql: string, params: unknown[] = []) => Number((await rows(sql, params))[0].n);
  const maxAudit = () => num('SELECT coalesce(max(log_id), 0) n FROM audit_log');
  const auditSince = (since: number) => rows('SELECT * FROM audit_log WHERE log_id > $1 ORDER BY log_id', [since]);

  const one = async (sql: string, params: unknown[] = []): Promise<number> => Number((await rows(sql, params))[0].id);
  const makeUser = async (loginId: string, role: string, instructorId: number | null = null) => {
    const id = await one(`INSERT INTO user_account (login_id, password_hash, name, linked_instructor_id) VALUES ($1, $2, $1, $3) RETURNING user_id id`, [loginId, passwordHash, instructorId]);
    await client.query(`INSERT INTO user_role (user_id, role_id) SELECT $1, role_id FROM role WHERE role_code = $2`, [id, role]);
    return id;
  };

  const agents = new Map<string, ReturnType<typeof request.agent>>();
  const as = async (who: 'sys' | 'ops' | 'exec' | 'ins1' | 'ins2' | 'anon') => {
    if (who === 'anon') return request(app.getHttpServer());
    const cached = agents.get(who);
    if (cached) return cached;
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ loginId: `e2e_${who}`, password: PASSWORD }).expect(200);
    agents.set(who, agent);
    return agent;
  };

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    pool = new RollbackPool(client);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PG_POOL).useValue(pool).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useLogger(false);
    await app.init();
    detection = moduleRef.get(DetectionRuleService);
  });
  afterAll(async () => {
    await app.close();
    await client.end();
  });

  beforeEach(async () => {
    agents.clear();
    pool.failOn = null;
    await client.query('BEGIN');
    expect(await num(`SELECT count(*) n FROM role_permission`), '시드(role_permission)가 필요합니다: npm run db:seed').toBeGreaterThan(0);
    i1 = await one(`INSERT INTO instructor (name, contact) VALUES ('강사1', '010-1111-2222') RETURNING instructor_id id`);
    i2 = await one(`INSERT INTO instructor (name) VALUES ('강사2') RETURNING instructor_id id`);
    sys = await makeUser('e2e_sys', 'SYS_ADMIN');
    ops = await makeUser('e2e_ops', 'OPS_MANAGER');
    exec = await makeUser('e2e_exec', 'EXECUTIVE');
    insUser1 = await makeUser('e2e_ins1', 'INSTRUCTOR', i1);
    insUser2 = await makeUser('e2e_ins2', 'INSTRUCTOR', i2);
    const course = (name: string) =>
      one(`INSERT INTO course (course_name, start_date, end_date, total_hours, training_site, manager_user_id, status) VALUES ($1, '2027-01-01', '2027-03-31', 100, '본원', $2, 'IN_PROGRESS') RETURNING course_id id`, [name, ops]);
    c1 = await course('과정1');
    c2 = await course('과정2');
    await client.query(`INSERT INTO instructor_assignment (instructor_id, course_id) VALUES ($1, $2), ($3, $4)`, [i1, c1, i2, c2]);
    const schedule = (course: number, instructor: number, round: number) =>
      one(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, $2, '2027-01-05', '09:00', '18:00', $3) RETURNING schedule_id id`, [course, round, instructor]);
    s1 = await schedule(c1, i1, 1);
    s2 = await schedule(c2, i2, 1);
    const trainee = (name: string) => one(`INSERT INTO trainee (name, birth_date, contact) VALUES ($1, '1990-03-05', '010-9999-8888') RETURNING trainee_id id`, [name]);
    const enroll = (t: number, c: number, status: string) => client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, $3)`, [t, c, status]);
    tConfirmed1 = await trainee('확정1');
    tApplied1 = await trainee('신청1');
    tConfirmed2 = await trainee('확정2');
    await enroll(tConfirmed1, c1, 'CONFIRMED');
    await enroll(tApplied1, c1, 'APPLIED');
    await enroll(tConfirmed2, c2, 'CONFIRMED');
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  // ── 인증·권한 ────────────────────────────────────────────────────────────
  describe('인증·권한 (V1)', () => {
    it('미인증 요청은 모든 도메인 엔드포인트에서 401', async () => {
      const anon = await as('anon');
      for (const path of ['/courses', '/instructors', '/trainees', '/schedules', '/enrollments', '/trainee-change-logs', '/instructor-change-logs', '/roles/permissions', '/audit-logs']) {
        expect((await anon.get(`/api/v1${path}`)).status, path).toBe(401);
      }
      expect((await anon.post('/api/v1/courses').send({})).status).toBe(401);
    });

    it('권한 없는 기능은 403 + ACCESS_DENIED 기록', async () => {
      const since = await maxAudit();
      const exec1 = await as('exec');
      expect((await exec1.post('/api/v1/courses').send({})).status).toBe(403);
      const ins = await as('ins1');
      expect((await ins.post('/api/v1/instructors').send({ name: 'x' })).status).toBe(403);
      expect((await ins.get('/api/v1/enrollments')).status).toBe(403); // 강사는 S02 접근 불가
      const sysAgent = await as('sys');
      expect((await sysAgent.patch(`/api/v1/courses/${c1}`).send({ course_name: 'x' })).status).toBe(403); // SYS 는 업무 데이터 조회 전용
      const denied = (await auditSince(since)).filter((r) => r.action === 'ACCESS_DENIED');
      expect(denied).toHaveLength(4);
      expect(denied[0].reason).toContain('NO_PERMISSION:S16:C');
    });
  });

  // ── 과정 ────────────────────────────────────────────────────────────────
  describe('과정 (S15·S16)', () => {
    const body = () => ({ course_name: '신규 과정', start_date: '2027-05-01', end_date: '2027-06-30', total_hours: 120, training_site: '별관', manager_user_id: ops });

    it('담당자 후보: 활성 OPS_MANAGER 의 ID·이름만, 과정 수정 권한(OPS)만 조회 가능 / 목록·상세에 담당자 이름 포함', async () => {
      const inactiveOps = await makeUser('e2e_ops_off', 'OPS_MANAGER');
      await client.query(`UPDATE user_account SET status = 'INACTIVE' WHERE user_id = $1`, [inactiveOps]);
      const ops1 = await as('ops');
      const candidates = (await ops1.get('/api/v1/courses/manager-candidates').expect(200)).body.items as { userId: number; name: string }[];
      expect(candidates).toContainEqual({ userId: ops, name: 'e2e_ops' });
      const ids = candidates.map((c) => c.userId);
      for (const excluded of [inactiveOps, sys, exec, insUser1]) expect(ids).not.toContain(excluded);
      expect(Object.keys(candidates[0]).sort()).toEqual(['name', 'userId']); // 로그인 ID·이메일 등은 내보내지 않는다
      for (const who of ['sys', 'exec', 'ins1'] as const) expect((await (await as(who)).get('/api/v1/courses/manager-candidates')).status, who).toBe(403);

      const list = (await ops1.get('/api/v1/courses').expect(200)).body.items as { courseId: number; managerName: string }[];
      expect(list.find((c) => c.courseId === c1)?.managerName).toBe('e2e_ops');
      expect((await ops1.get(`/api/v1/courses/${c1}`).expect(200)).body.managerName).toBe('e2e_ops');
    });

    it('상세·대시보드의 회차에 표시 상태(displayStatus: 지난 회차는 COMPLETED 계산값) 포함', async () => {
      await client.query(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 90, '2020-01-01', '09:00', '10:00', $2)`, [c1, i1]);
      await client.query(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id, status) VALUES ($1, 91, '2020-01-02', '09:00', '10:00', $2, 'CANCELLED')`, [c1, i1]);
      const ops1 = await as('ops');
      const byRound = new Map(((await ops1.get(`/api/v1/courses/${c1}`).expect(200)).body.schedules as { roundNo: number; status: string; displayStatus: string }[]).map((s) => [s.roundNo, s]));
      expect(byRound.get(90)).toMatchObject({ status: 'SCHEDULED', displayStatus: 'COMPLETED' });
      expect(byRound.get(91)).toMatchObject({ status: 'CANCELLED', displayStatus: 'CANCELLED' });
      expect(byRound.get(1)).toMatchObject({ status: 'SCHEDULED', displayStatus: 'SCHEDULED' }); // 2027-01-05 미래 회차
      // 강사 스코프(본인 회차만)에서도 파라미터 순서가 맞아야 한다
      const insSchedules = (await (await as('ins1')).get(`/api/v1/courses/${c1}`).expect(200)).body.schedules as { roundNo: number; displayStatus: string }[];
      expect(insSchedules.find((s) => s.roundNo === 90)?.displayStatus).toBe('COMPLETED');
      const past = (await ops1.get('/api/v1/dashboard?date=2020-01-01').expect(200)).body.todaySchedules as { roundNo: number; displayStatus: string }[];
      expect(past.find((s) => s.roundNo === 90)?.displayStatus).toBe('COMPLETED');
    });

    it('등록: PREPARING 으로 생성되고 audit_log(CREATE)와 created_by 가 남는다', async () => {
      const since = await maxAudit();
      const res = await (await as('ops')).post('/api/v1/courses').send(body()).expect(201);
      expect(res.body).toMatchObject({ courseName: '신규 과정', startDate: '2027-05-01', status: 'PREPARING', managerUserId: ops });
      const stored = (await rows('SELECT created_by FROM course WHERE course_id = $1', [res.body.courseId]))[0];
      expect(stored.created_by).toBe(String(ops));
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'course');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'CREATE', actor_type: 'USER', actor_user_id: String(ops), target_id: String(res.body.courseId) });
    });

    it('등록 검증: 필수·날짜 역전·비활성 담당자는 400 이고 아무것도 저장되지 않는다', async () => {
      const ops1 = await as('ops');
      const before = await num('SELECT count(*) n FROM course');
      const since = await maxAudit();
      expect((await ops1.post('/api/v1/courses').send({ ...body(), course_name: '' })).status).toBe(400);
      expect((await ops1.post('/api/v1/courses').send({ ...body(), start_date: '2027-02-30' })).status).toBe(400);
      expect((await ops1.post('/api/v1/courses').send({ ...body(), end_date: '2027-04-01' })).body.code).toBe('INVALID_DATE_RANGE');
      expect((await ops1.post('/api/v1/courses').send({ ...body(), total_hours: 0 })).status).toBe(400);
      expect((await ops1.post('/api/v1/courses').send({ ...body(), manager_user_id: exec })).body.code).toBe('INVALID_MANAGER'); // P1-18: OPS_MANAGER 역할이 아님(EXECUTIVE)
      const inactiveManager = await makeUser('e2e_ops_inactive', 'OPS_MANAGER');
      await client.query(`UPDATE user_account SET status = 'INACTIVE' WHERE user_id = $1`, [inactiveManager]);
      expect((await ops1.post('/api/v1/courses').send({ ...body(), manager_user_id: inactiveManager })).body.code).toBe('INVALID_MANAGER'); // P1-18: 역할은 맞지만 비활성
      expect(await num('SELECT count(*) n FROM course')).toBe(before);
      expect((await auditSince(since)).filter((r) => r.action === 'CREATE')).toHaveLength(0);
    });

    it('수정: 변경 필드만 바뀌고 audit_log 에 before/after 가 남는다, 병합 후 날짜 역전은 400', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      const res = await ops1.patch(`/api/v1/courses/${c1}`).send({ training_site: '신관', reason: '장소 변경' }).expect(200);
      expect(res.body).toMatchObject({ trainingSite: '신관', courseName: '과정1' });
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'course');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'UPDATE', reason: '장소 변경' });
      expect(logs[0].before_value.training_site).toBe('본원');
      expect(logs[0].after_value.training_site).toBe('신관');
      expect((await ops1.patch(`/api/v1/courses/${c1}`).send({ end_date: '2026-12-31' })).body.code).toBe('INVALID_DATE_RANGE');
      expect((await ops1.patch(`/api/v1/courses/${c1}`).send({})).status).toBe(400);
    });

    it('상태 전이: 모집 시작 → 운영중(확정 0명 경고) → 중단(사유 필수), 허용되지 않는 전이는 409', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post('/api/v1/courses').send(body()).expect(201)).body.courseId;
      const since = await maxAudit();
      expect((await ops1.post(`/api/v1/courses/${created}/open-recruitment`).expect(200)).body.status).toBe('RECRUITING');
      expect((await ops1.post(`/api/v1/courses/${created}/open-recruitment`)).body.code).toBe('INVALID_STATE_TRANSITION');
      expect((await ops1.post(`/api/v1/courses/${created}/start`).send({})).body.code).toBe('NO_CONFIRMED_TRAINEES');
      expect((await ops1.post(`/api/v1/courses/${created}/start`).send({ acknowledge_no_confirmed_trainees: true })).body.status).toBe('IN_PROGRESS');
      expect((await ops1.post(`/api/v1/courses/${created}/suspend`).send({})).status).toBe(400);
      expect((await ops1.post(`/api/v1/courses/${created}/suspend`).send({ reason: '수강생 미달' })).body.status).toBe('SUSPENDED');
      // 최종 상태: 어떤 전이·수정도 불가
      expect((await ops1.post(`/api/v1/courses/${created}/start`).send({ acknowledge_no_confirmed_trainees: true })).body.code).toBe('INVALID_STATE_TRANSITION');
      expect((await ops1.patch(`/api/v1/courses/${created}`).send({ training_site: 'x' })).body.code).toBe('COURSE_LOCKED');
      const updates = (await auditSince(since)).filter((r) => r.target_table === 'course' && r.action === 'UPDATE');
      expect(updates.map((r) => r.after_value.status)).toEqual(['RECRUITING', 'IN_PROGRESS', 'SUSPENDED']);
      expect(updates[2].reason).toBe('수강생 미달');
    });

    it('확정 훈련생이 있으면 경고 확인 없이 운영중 전환', async () => {
      const ops1 = await as('ops');
      await client.query(`UPDATE course SET status = 'RECRUITING' WHERE course_id = $1`, [c1]);
      expect((await ops1.post(`/api/v1/courses/${c1}/start`).send({})).body.status).toBe('IN_PROGRESS');
    });

    it('목록: 운영담당자는 전체, 강사는 본인 배정 과정만(총 건수도 범위 내), 필터 동작', async () => {
      const all = (await (await as('ops')).get('/api/v1/courses?size=100')).body;
      const names = all.items.map((c: { courseName: string }) => c.courseName);
      expect(names).toEqual(expect.arrayContaining(['과정1', '과정2']));
      const own = (await (await as('ins1')).get('/api/v1/courses')).body;
      expect(own.total).toBe(1);
      expect(own.items[0]).toMatchObject({ courseId: c1, confirmedTraineeCount: 1 });
      expect((await (await as('ins1')).get(`/api/v1/courses?name=${encodeURIComponent('과정2')}`)).body.total).toBe(0);
      expect((await (await as('ops')).get(`/api/v1/courses?status=CLOSED,SUSPENDED&name=${encodeURIComponent('과정1')}`)).body.total).toBe(0);
      expect((await (await as('ops')).get('/api/v1/courses?status=BOGUS')).status).toBe(400);
    });

    it('상세: 강사는 타 과정 404 + ACCESS_DENIED(SCOPE_VIOLATION), 본인 과정은 본인 회차만', async () => {
      const ins = await as('ins1');
      const since = await maxAudit();
      expect((await ins.get(`/api/v1/courses/${c2}`)).status).toBe(404);
      const denied = (await auditSince(since)).filter((r) => r.action === 'ACCESS_DENIED');
      expect(denied).toHaveLength(1);
      expect(denied[0].reason).toContain('SCOPE_VIOLATION:course');
      // 본인 과정: 다른 강사의 회차·배정은 보이지 않고 확정 이전 등록 건은 집계에서 제외
      await client.query(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 2, '2027-01-06', '09:00', '18:00', $2)`, [c1, i2]);
      const detail = (await ins.get(`/api/v1/courses/${c1}`).expect(200)).body;
      expect(detail.schedules.map((s: { scheduleId: number }) => s.scheduleId)).toEqual([s1]);
      expect(detail.instructorAssignments.map((a: { instructorId: number }) => a.instructorId)).toEqual([i1]);
      expect(detail.traineeSummary).toEqual([{ status: 'CONFIRMED', count: 1 }]);
      const full = (await (await as('ops')).get(`/api/v1/courses/${c1}`).expect(200)).body;
      expect(full.schedules).toHaveLength(2);
      expect(full.traineeSummary).toEqual(expect.arrayContaining([{ status: 'APPLIED', count: 1 }]));
      expect((await (await as('ops')).get('/api/v1/courses/999999999')).status).toBe(404);
      expect((await (await as('ops')).get('/api/v1/courses/abc')).status).toBe(400);
    });
  });

  // ── 종료 체크리스트·종료 (baseline 9절, decisions.md D-06·P1-03) ─────────
  describe('종료 체크리스트·종료 (S16)', () => {
    const pastSchedule = () =>
      one(
        `INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 99, '2020-01-01', '09:00', '10:00', $2) RETURNING schedule_id id`,
        [c1, i1],
      );

    it('체크리스트: 필수차단(미출결·미종결 확인 건)·경고(운영일지·결과물미제출·확정잔여) 항목별 건수 계산, INSTRUCTOR 는 403', async () => {
      await pastSchedule();
      const manual = await one(`SELECT rule_id id FROM detection_rule WHERE rule_code = 'MANUAL'`);
      await client.query(
        `INSERT INTO verification_case (course_id, detection_rule_id, detected_at, evidence, status) VALUES ($1, $2, now(), '{"dedupe_key":"t","items":[{"id":"t"}]}', 'NEEDS_CHECK')`,
        [c1, manual],
      );
      const ops1 = await as('ops');
      const checklist = (await ops1.get(`/api/v1/courses/${c1}/closure-checklist`).expect(200)).body;
      const byItem = new Map(checklist.items.map((i: { item: number }) => [i.item, i]));
      expect(byItem.get(1)).toMatchObject({ classification: 'BLOCKING', count: 1 });
      expect(byItem.get(3)).toMatchObject({ classification: 'BLOCKING', count: 1 });
      expect(byItem.get(4)).toMatchObject({ classification: 'WARNING', count: 1 });
      expect(byItem.get(5)).toMatchObject({ classification: 'WARNING', count: 1 });
      expect(byItem.get(7)).toMatchObject({ classification: 'WARNING', count: 1 });
      expect(byItem.get(2)).toMatchObject({ count: 0 });
      expect(byItem.get(8)).toMatchObject({ count: 0 });
      expect(byItem.get(9)).toMatchObject({ classification: 'NOT_NEEDED' });

      const ins1 = await as('ins1');
      expect((await ins1.get(`/api/v1/courses/${c1}/closure-checklist`)).status).toBe(403);
      const exec1 = await as('exec');
      expect((await exec1.get(`/api/v1/courses/${c1}/closure-checklist`)).status).toBe(200);
    });

    it('종료: 필수 차단 항목이 있으면 409(CLOSURE_BLOCKED), 과정 상태는 그대로', async () => {
      await pastSchedule();
      const ops1 = await as('ops');
      expect((await ops1.post(`/api/v1/courses/${c1}/close`).send({})).body.code).toBe('CLOSURE_BLOCKED');
      expect((await rows('SELECT status FROM course WHERE course_id = $1', [c1]))[0].status).toBe('IN_PROGRESS');
    });

    it('종료: 경고만 있으면 override_reason 필수, 성공 시 CLOSED + 미해결 스냅샷·사유가 audit_log에 남는다', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      expect((await ops1.post(`/api/v1/courses/${c1}/close`).send({})).status).toBe(400); // 경고(결과물 미제출·확정잔여) 있는데 override_reason 없음

      const closed = (await ops1.post(`/api/v1/courses/${c1}/close`).send({ override_reason: '결과물은 추후 별도 관리' }).expect(200)).body;
      expect(closed.status).toBe('CLOSED');
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'course' && r.action === 'UPDATE');
      expect(logs).toHaveLength(2); // course 행 자체의 before/after 1건 + 미해결 항목 스냅샷 1건
      expect(logs.some((r) => r.reason === '결과물은 추후 별도 관리')).toBe(true);
      expect(logs.some((r) => r.after_value?.closureChecklistSnapshot)).toBe(true);

      expect((await ops1.post(`/api/v1/courses/${c1}/close`).send({ override_reason: 'x' })).body.code).toBe('INVALID_STATE_TRANSITION');
      expect((await ops1.patch(`/api/v1/courses/${c1}`).send({ training_site: 'x' })).body.code).toBe('COURSE_LOCKED'); // V7
    });

    it('권한: INSTRUCTOR·EXECUTIVE·SYS_ADMIN 은 종료를 실행할 수 없다(OPS 단독, D-06)', async () => {
      for (const who of ['ins1', 'exec', 'sys'] as const) {
        const agent = await as(who);
        expect((await agent.post(`/api/v1/courses/${c1}/close`).send({ override_reason: 'x' })).status, who).toBe(403);
      }
    });
  });

  // ── 강사 ────────────────────────────────────────────────────────────────
  describe('강사 (S11·S12·S14)', () => {
    it('등록·수정: 사유 필수, instructor_change_log + audit_log 동시 기록, 연락처 마스킹', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      const created = (await ops1.post('/api/v1/instructors').send({ name: '신규강사', contact: '010-5555-6666' }).expect(201)).body;
      expect(created).toMatchObject({ name: '신규강사', status: 'ACTIVE', contact: '***-****-6666' });
      expect((await ops1.patch(`/api/v1/instructors/${created.instructorId}`).send({ name: '개명' })).status).toBe(400); // 사유 없음
      const logsBefore = await num(`SELECT count(*) n FROM instructor_change_log WHERE entity_id = $1`, [created.instructorId]);
      const res = await ops1.patch(`/api/v1/instructors/${created.instructorId}`).send({ name: '개명', contact: '010-7777-8888', reason: '개명 신청' }).expect(200);
      expect(res.body).toMatchObject({ name: '개명', contact: '***-****-8888' });
      expect((await rows(`SELECT contact FROM instructor WHERE instructor_id = $1`, [created.instructorId]))[0].contact).toBe('010-7777-8888');
      const changeLogs = await rows(`SELECT * FROM instructor_change_log WHERE entity_type = 'INSTRUCTOR' AND entity_id = $1`, [created.instructorId]);
      expect(changeLogs).toHaveLength(logsBefore + 1);
      expect(changeLogs[0]).toMatchObject({ changed_by: String(ops), reason: '개명 신청' });
      expect(JSON.stringify(changeLogs[0])).not.toContain('010-7777-8888');
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'instructor');
      expect(logs.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
      expect(JSON.stringify(logs)).not.toContain('010-7777-8888');
    });

    it('비활동 전환 시 진행 중 배정 경고를 반환한다(차단하지 않음)', async () => {
      const res = await (await as('ops')).patch(`/api/v1/instructors/${i1}`).send({ status: 'INACTIVE', reason: '계약 종료' }).expect(200);
      expect(res.body.status).toBe('INACTIVE');
      expect(res.body.warnings).toEqual({ inProgressAssignmentCount: 1 });
    });

    it('강사 계정은 본인 정보만 조회, 타인은 404 + ACCESS_DENIED', async () => {
      const ins = await as('ins1');
      const list = (await ins.get('/api/v1/instructors')).body;
      expect(list.items.map((i: { instructorId: number }) => i.instructorId)).toEqual([i1]);
      expect(list.items[0]).toMatchObject({ assignedCourseCount: 1, contact: '***-****-2222' });
      const detail = (await ins.get(`/api/v1/instructors/${i1}`).expect(200)).body;
      expect(detail.linkedAccount).toMatchObject({ userId: insUser1, loginId: 'e2e_ins1' });
      expect(JSON.stringify(detail)).not.toContain('password');
      const since = await maxAudit();
      expect((await ins.get(`/api/v1/instructors/${i2}`)).status).toBe(404);
      expect((await auditSince(since)).filter((r) => r.action === 'ACCESS_DENIED')).toHaveLength(1);
      expect((await (await as('ops')).get('/api/v1/instructors?size=100')).body.total).toBeGreaterThanOrEqual(2);
    });

    it('변경이력 조회: 강사·배정 이력을 강사 기준으로 모아서 볼 수 있다', async () => {
      const ops1 = await as('ops');
      await ops1.patch(`/api/v1/instructors/${i1}`).send({ name: '강사1b', reason: '정정' }).expect(200);
      const assignmentId = (await ops1.post(`/api/v1/courses/${c2}/instructor-assignments`).send({ instructor_id: i1, round_no: 5 }).expect(201)).body.assignmentId;
      await ops1.post(`/api/v1/instructor-assignments/${assignmentId}/cancel`).send({ reason: '일정 충돌' }).expect(200);
      const res = (await (await as('exec')).get(`/api/v1/instructor-change-logs?instructor_id=${i1}`).expect(200)).body;
      expect(res.items.map((l: { entityType: string }) => l.entityType).sort()).toEqual(['ASSIGNMENT', 'INSTRUCTOR']);
      // S14 "대상" 표시용: 강사 이력·배정 이력 모두 강사명, 배정 이력은 과정·회차 범위까지
      const byType = Object.fromEntries(res.items.map((l: { entityType: string }) => [l.entityType, l]));
      expect(byType.INSTRUCTOR).toMatchObject({ instructorId: i1, instructorName: '강사1b', courseId: null, courseName: null, roundNo: null });
      expect(byType.ASSIGNMENT).toMatchObject({ instructorId: i1, instructorName: '강사1b', courseId: c2, courseName: '과정2', roundNo: 5 });
      expect((await (await as('exec')).get(`/api/v1/instructor-change-logs?instructor_id=${i1}&entity_type=ASSIGNMENT`)).body.total).toBe(1);
      expect((await (await as('ins1')).get('/api/v1/instructor-change-logs')).status).toBe(403);
    });
  });

  // ── 훈련생·등록 ─────────────────────────────────────────────────────────
  describe('훈련생·등록 (S02~S06)', () => {
    const newEnrollment = (course: number) => ({ course_id: course, trainee: { name: '김신규', birth_date: '1995-07-21', contact: '010-2222-3333' } });

    it('등록: 신규 인물 + 등록 건이 한 번에 생성되고 audit_log CREATE 2건(연락처 마스킹)이 남는다', async () => {
      const since = await maxAudit();
      const res = await (await as('ops')).post('/api/v1/enrollments').send(newEnrollment(c1)).expect(201);
      expect(res.body.enrollment).toMatchObject({ courseId: c1, status: 'APPLIED' });
      expect(res.body.trainee).toMatchObject({ name: '김신규', contact: '***-****-3333', birthDate: '1995-**-**' });
      const logs = await auditSince(since);
      expect(logs.filter((r) => r.action === 'CREATE').map((r) => r.target_table).sort()).toEqual(['trainee', 'trainee_enrollment']);
      expect(JSON.stringify(logs)).not.toContain('010-2222-3333');
    });

    it('기존 인물 재사용, 같은 과정 재등록은 409, 종료·중단 과정은 거부, 입력 오류는 400', async () => {
      const ops1 = await as('ops');
      expect((await ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee_id: tConfirmed1 })).body.code).toBe('ENROLLMENT_EXISTS');
      expect((await ops1.post('/api/v1/enrollments').send({ course_id: c2, trainee_id: tConfirmed1 }).expect(201)).body.enrollment.status).toBe('APPLIED');
      await client.query(`UPDATE course SET status = 'CLOSED' WHERE course_id = $1`, [c2]);
      expect((await ops1.post('/api/v1/enrollments').send(newEnrollment(c2))).body.code).toBe('COURSE_LOCKED');
      expect((await ops1.post('/api/v1/enrollments').send({ course_id: c1 })).status).toBe(400);
      expect((await ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee_id: tApplied1, trainee: { name: 'x' } })).status).toBe(400);
      expect((await ops1.post('/api/v1/enrollments').send({ course_id: 999999999, trainee: { name: 'x' } })).status).toBe(404);
    });

    it('상태 전이: 확인 착수 → 확정 → 각 단계마다 change_log(ENROLLMENT)와 audit_log 가 1건씩, 확정 시 confirmed_at/by', async () => {
      const ops1 = await as('ops');
      const enrollmentId = (await ops1.post('/api/v1/enrollments').send(newEnrollment(c1)).expect(201)).body.enrollment.enrollmentId;
      const since = await maxAudit();
      expect((await ops1.post(`/api/v1/enrollments/${enrollmentId}/confirm`)).body.code).toBe('INVALID_STATE_TRANSITION'); // 확인 착수 전
      expect((await ops1.post(`/api/v1/enrollments/${enrollmentId}/start-review`).expect(200)).body.status).toBe('REVIEWING');
      const confirmed = (await ops1.post(`/api/v1/enrollments/${enrollmentId}/confirm`).send({ reason: '서류 확인 완료' }).expect(200)).body;
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', confirmedBy: ops });
      expect(confirmed.confirmedAt).toBeTruthy();
      const changeLogs = await rows(`SELECT * FROM trainee_change_log WHERE entity_type = 'ENROLLMENT' AND entity_id = $1 ORDER BY log_id`, [enrollmentId]);
      expect(changeLogs.map((l) => l.after_value.status)).toEqual(['REVIEWING', 'CONFIRMED']);
      expect(changeLogs.map((l) => l.reason)).toEqual(['대상자 확인 착수', '서류 확인 완료']);
      expect(changeLogs.every((l) => l.changed_by === String(ops))).toBe(true);
      const updates = (await auditSince(since)).filter((r) => r.target_table === 'trainee_enrollment' && r.action === 'UPDATE');
      expect(updates).toHaveLength(2);
      expect((await ops1.post(`/api/v1/enrollments/${enrollmentId}/reject`).send({ cancel_reason: '늦은 반려' })).body.code).toBe('INVALID_STATE_TRANSITION'); // 확정 후 반려 불가
    });

    it('반려: cancel_reason 필수, CANCELLED + 사유 저장 + 변경이력 사유', async () => {
      const ops1 = await as('ops');
      const enrollmentId = (await ops1.post('/api/v1/enrollments').send(newEnrollment(c1)).expect(201)).body.enrollment.enrollmentId;
      expect((await ops1.post(`/api/v1/enrollments/${enrollmentId}/reject`).send({})).status).toBe(400);
      const res = (await ops1.post(`/api/v1/enrollments/${enrollmentId}/reject`).send({ cancel_reason: '자격 미달' }).expect(200)).body;
      expect(res).toMatchObject({ status: 'CANCELLED', cancelReason: '자격 미달' });
      const log = (await rows(`SELECT * FROM trainee_change_log WHERE entity_type = 'ENROLLMENT' AND entity_id = $1`, [enrollmentId]))[0];
      expect(log.reason).toBe('자격 미달');
      expect((await ops1.post(`/api/v1/enrollments/${enrollmentId}/start-review`)).body.code).toBe('INVALID_STATE_TRANSITION'); // 취소는 최종
    });

    it('P1-01: 반려(취소) 후 재신청은 신규 등록 건이 생성되고 이전 취소 건·사유·변경이력이 보존된다', async () => {
      const ops1 = await as('ops');
      const first = (await ops1.post('/api/v1/enrollments').send(newEnrollment(c1)).expect(201)).body;
      const traineeId = first.trainee.traineeId;
      const firstId = first.enrollment.enrollmentId;
      expect((await ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee_id: traineeId })).body.code).toBe('ENROLLMENT_EXISTS'); // 유효 건이 있으면 거부
      await ops1.post(`/api/v1/enrollments/${firstId}/reject`).send({ cancel_reason: '서류 미비' }).expect(200);

      const since = await maxAudit();
      const second = (await ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee_id: traineeId }).expect(201)).body;
      expect(second.enrollment.enrollmentId).not.toBe(firstId);
      expect(second.enrollment.status).toBe('APPLIED');
      expect((await auditSince(since)).filter((r) => r.action === 'CREATE' && r.target_table === 'trainee_enrollment')).toHaveLength(1);
      // 이전 취소 건은 그대로(상태·사유), 변경이력도 그대로
      expect((await rows('SELECT status, cancel_reason FROM trainee_enrollment WHERE enrollment_id = $1', [firstId]))[0]).toEqual({ status: 'CANCELLED', cancel_reason: '서류 미비' });
      expect(await num(`SELECT count(*) n FROM trainee_change_log WHERE entity_type = 'ENROLLMENT' AND entity_id = $1`, [firstId])).toBe(1);
      // 재신청 건도 정상 흐름을 탄다. 다시 취소하면 또 재신청 가능(취소 행 여러 개)
      await ops1.post(`/api/v1/enrollments/${second.enrollment.enrollmentId}/reject`).send({ cancel_reason: '재반려' }).expect(200);
      const third = (await ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee_id: traineeId }).expect(201)).body;
      expect(await num(`SELECT count(*) n FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2`, [traineeId, c1])).toBe(3);
      // 확정된 뒤에는 재신청 불가(유효 건)
      await ops1.post(`/api/v1/enrollments/${third.enrollment.enrollmentId}/start-review`).expect(200);
      await ops1.post(`/api/v1/enrollments/${third.enrollment.enrollmentId}/confirm`).expect(200);
      expect((await ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee_id: traineeId })).body.code).toBe('ENROLLMENT_EXISTS');
      // 훈련생 상세의 등록 이력에는 모든 건이 보인다
      expect((await (await as('exec')).get(`/api/v1/trainees/${traineeId}/enrollments`).expect(200)).body.items).toHaveLength(3);
    });

    it('P1-04: 수료·중도포기·제적은 확정 상태에서만 사유와 함께 수동 전환, 이력·감사 기록, 최종 상태 이후 재전이 불가', async () => {
      const ops1 = await as('ops');
      const enrollmentId = await one(`SELECT enrollment_id id FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2`, [tConfirmed1, c1]);
      expect((await ops1.post(`/api/v1/enrollments/${enrollmentId}/complete`).send({})).status).toBe(400); // 사유 필수
      const appliedEnrollmentId = await one(`SELECT enrollment_id id FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2`, [tApplied1, c1]);
      expect((await ops1.post(`/api/v1/enrollments/${appliedEnrollmentId}/expel`).send({ reason: 'x' })).body.code).toBe('INVALID_STATE_TRANSITION'); // 확정 이전

      const since = await maxAudit();
      const completed = (await ops1.post(`/api/v1/enrollments/${enrollmentId}/complete`).send({ reason: '출석률 90%' }).expect(200)).body;
      expect(completed.status).toBe('COMPLETED');
      const log = (await rows(`SELECT * FROM trainee_change_log WHERE entity_type = 'ENROLLMENT' AND entity_id = $1`, [enrollmentId]))[0];
      expect(log).toMatchObject({ changed_by: String(ops), reason: '출석률 90%' });
      expect(log.after_value.status).toBe('COMPLETED');
      expect((await auditSince(since)).filter((r) => r.target_table === 'trainee_enrollment' && r.action === 'UPDATE')).toHaveLength(1);
      expect((await ops1.post(`/api/v1/enrollments/${enrollmentId}/drop`).send({ reason: 'x' })).body.code).toBe('INVALID_STATE_TRANSITION'); // 최종 상태

      const enrollment2 = await one(`SELECT enrollment_id id FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2`, [tConfirmed2, c2]);
      expect((await ops1.post(`/api/v1/enrollments/${enrollment2}/drop`).send({ reason: '개인 사정' }).expect(200)).body.status).toBe('DROPPED');
    });

    it('대상자 목록(S02): 상태·과정·이름 필터, 강사는 접근 불가', async () => {
      const list = (await (await as('exec')).get(`/api/v1/enrollments?status=APPLIED&course_id=${c1}`).expect(200)).body;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ traineeId: tApplied1, name: '신청1', status: 'APPLIED' });
      expect((await (await as('ops')).get(`/api/v1/enrollments?name=${encodeURIComponent('확정')}`)).body.total).toBe(2);
    });

    it('완료 후보(D-05 §6): 마지막 회차 종료 전에는 준비되지 않음(ready=false)', async () => {
      const res = (await (await as('ops')).get(`/api/v1/courses/${c1}/completion-candidates`).expect(200)).body;
      expect(res).toEqual({ ready: false, threshold: 0.8, lateWeight: 0.5, items: [] }); // s1 은 미래 회차(2027-01-05)
    });

    it('완료 후보: 마지막 회차 종료 후 가중 출석률(LATE=0.5, EXCUSED=1.0) 계산, 80% 미달만 표시, 조회는 감사로그를 남기지 않는다', async () => {
      await client.query(`UPDATE class_schedule SET class_date = '2020-01-01' WHERE schedule_id = $1`, [s1]);
      const ops1 = await as('ops');
      const since = await maxAudit();
      const noAttendance = (await ops1.get(`/api/v1/courses/${c1}/completion-candidates`).expect(200)).body;
      expect(noAttendance.ready).toBe(true);
      expect(noAttendance.items).toEqual([expect.objectContaining({ traineeId: tConfirmed1, name: '확정1', attendanceRate: 0 })]); // 출결 없음 = 0%

      await client.query(`INSERT INTO attendance (trainee_id, schedule_id, attendance_status, source_type) VALUES ($1, $2, 'PRESENT', 'MANUAL')`, [tConfirmed1, s1]);
      expect((await ops1.get(`/api/v1/courses/${c1}/completion-candidates`).expect(200)).body.items).toEqual([]); // 100% ≥ 80%

      await client.query(`UPDATE attendance SET attendance_status = 'LATE' WHERE trainee_id = $1 AND schedule_id = $2`, [tConfirmed1, s1]);
      const late = (await ops1.get(`/api/v1/courses/${c1}/completion-candidates`).expect(200)).body;
      expect(late.items).toEqual([expect.objectContaining({ attendanceRate: 0.5 })]); // LATE 가중치 0.5 < 80%

      await client.query(`UPDATE attendance SET attendance_status = 'EXCUSED' WHERE trainee_id = $1 AND schedule_id = $2`, [tConfirmed1, s1]);
      expect((await ops1.get(`/api/v1/courses/${c1}/completion-candidates`).expect(200)).body.items).toEqual([]); // 인정결석 전액 인정 ≥ 80%
      expect(await auditSince(since)).toHaveLength(0); // 단순 조회, audit_log 없음
    });

    it('완료 후보: 강사는 S02 권한이 없어 403, 존재하지 않는 과정은 404', async () => {
      expect((await (await as('ins1')).get(`/api/v1/courses/${c1}/completion-candidates`)).status).toBe(403);
      expect((await (await as('ops')).get('/api/v1/courses/999999999/completion-candidates')).status).toBe(404);
    });

    it('인적정보 수정: 사유 필수, trainee_change_log + audit_log 에 마스킹 값만, 원본에는 실제 값', async () => {
      const ops1 = await as('ops');
      expect((await ops1.patch(`/api/v1/trainees/${tConfirmed1}`).send({ contact: '010-0000-1111' })).status).toBe(400);
      const since = await maxAudit();
      const res = (await ops1.patch(`/api/v1/trainees/${tConfirmed1}`).send({ contact: '010-0000-1111', reason: '번호 변경' }).expect(200)).body;
      expect(res.contact).toBe('***-****-1111');
      expect((await rows(`SELECT contact FROM trainee WHERE trainee_id = $1`, [tConfirmed1]))[0].contact).toBe('010-0000-1111');
      const log = (await rows(`SELECT * FROM trainee_change_log WHERE entity_type = 'TRAINEE' AND entity_id = $1`, [tConfirmed1]))[0];
      expect(log).toMatchObject({ changed_by: String(ops), reason: '번호 변경' });
      expect(log.before_value.contact).toBe('***-****-8888');
      expect(JSON.stringify([log, await auditSince(since)])).not.toMatch(/010-9999-8888|010-0000-1111/);
      const changes = (await (await as('exec')).get(`/api/v1/trainee-change-logs?trainee_id=${tConfirmed1}`).expect(200)).body;
      expect(changes.total).toBe(1);
      expect(changes.items[0]).toMatchObject({ traineeId: tConfirmed1, traineeName: '확정1', courseName: null });
      // 훈련생명 검색(S06): 인적정보 변경(TRAINEE)과 등록 건 변경(ENROLLMENT) 모두 이름으로 찾는다
      await ops1.post(`/api/v1/enrollments/${await one(`SELECT enrollment_id id FROM trainee_enrollment WHERE trainee_id = $1`, [tApplied1])}/start-review`).send({}).expect(200);
      const byName = (await (await as('exec')).get(`/api/v1/trainee-change-logs?trainee_name=${encodeURIComponent('신청')}`).expect(200)).body;
      expect(byName.items).toEqual([expect.objectContaining({ entityType: 'ENROLLMENT', traineeId: tApplied1, traineeName: '신청1', courseName: '과정1' })]);
    });

    it('중복 후보 검색·훈련생 목록(S03): 마스킹, 기본은 확정 이후 상태만', async () => {
      const search = (await (await as('ops')).get(`/api/v1/trainees/search?name=${encodeURIComponent('확정1')}&birth_date=1990-03-05`).expect(200)).body;
      expect(search.items).toEqual([expect.objectContaining({ traineeId: tConfirmed1, contact: '***-****-8888', birthDate: '1990-**-**', enrollmentCount: 1 })]);
      expect((await (await as('ops')).get('/api/v1/trainees/search')).status).toBe(400);
      const list = (await (await as('exec')).get(`/api/v1/trainees?size=100`).expect(200)).body;
      expect(list.items.find((t: { traineeId: number }) => t.traineeId === tConfirmed1)).toMatchObject({ birthDate: '1990-**-**', contact: '***-****-8888' });
      const s02 = (await (await as('ops')).get(`/api/v1/enrollments?course_id=${c1}`).expect(200)).body;
      expect(s02.items.find((e: { traineeId: number }) => e.traineeId === tConfirmed1).birthDate).toBe('1990-**-**'); // S02 목록도 생년월일은 연도만
      const ids = list.items.map((t: { traineeId: number }) => t.traineeId);
      expect(ids).toEqual(expect.arrayContaining([tConfirmed1, tConfirmed2]));
      expect(ids).not.toContain(tApplied1);
      expect(list.items[0].contact).toMatch(/^\*\*\*-\*\*\*\*-\d{4}$/);
      expect((await (await as('exec')).get(`/api/v1/trainees?status=APPLIED&course_id=${c1}`)).body.items.map((t: { traineeId: number }) => t.traineeId)).toEqual([tApplied1]);
      expect((await (await as('exec')).get('/api/v1/trainees?contact=010')).status).toBe(400);
      expect((await (await as('exec')).get('/api/v1/trainees?contact=8888')).body.total).toBeGreaterThanOrEqual(2);
    });

    it('강사 스코프: 본인 과정의 확정 이후 훈련생만(목록·상세·등록 이력), 그 외 404 + ACCESS_DENIED', async () => {
      const ins = await as('ins1');
      const list = (await ins.get('/api/v1/trainees?status=APPLIED,CONFIRMED').expect(200)).body; // 확정 이전 상태를 요청해도 스코프가 우선
      expect(list.items.map((t: { traineeId: number }) => t.traineeId)).toEqual([tConfirmed1]);
      expect(list.total).toBe(1);
      const since = await maxAudit();
      expect((await ins.get(`/api/v1/trainees/${tConfirmed2}`)).status).toBe(404); // 타 과정
      expect((await ins.get(`/api/v1/trainees/${tApplied1}`)).status).toBe(404); // 본인 과정이지만 확정 이전
      expect((await ins.get(`/api/v1/trainees/${tConfirmed2}/enrollments`)).status).toBe(404);
      expect((await auditSince(since)).filter((r) => r.action === 'ACCESS_DENIED' && /SCOPE_VIOLATION:trainee/.test(r.reason))).toHaveLength(3);
      // 본인 훈련생이 타 과정에도 등록되어 있으면 타 과정 등록은 보이지 않는다
      await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, 'CONFIRMED')`, [tConfirmed1, c2]);
      const detail = (await ins.get(`/api/v1/trainees/${tConfirmed1}`).expect(200)).body;
      expect(detail).toMatchObject({ name: '확정1', contact: '***-****-8888', birthDate: '1990-**-**' });
      expect(detail.enrollments.map((e: { courseId: number }) => e.courseId)).toEqual([c1]);
      expect((await ins.get('/api/v1/trainees?course_id=' + c2)).body.total).toBe(0);
    });

    it('S05 출결 요약: 회차별 출결(미출결 계산 포함), course_id 필수, 등록 안 된 과정은 404', async () => {
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201);
      const summary = (await ops1.get(`/api/v1/trainees/${tConfirmed1}/attendance-summary?course_id=${c1}`).expect(200)).body;
      expect(summary.items).toEqual([expect.objectContaining({ scheduleId: s1, displayStatus: 'PRESENT' })]);
      expect((await ops1.get(`/api/v1/trainees/${tConfirmed1}/attendance-summary`)).status).toBe(400); // course_id 필수
      expect((await ops1.get(`/api/v1/trainees/${tConfirmed1}/attendance-summary?course_id=${c2}`)).status).toBe(404); // 등록 안 됨
      const ins1 = await as('ins1');
      expect((await ins1.get(`/api/v1/trainees/${tConfirmed1}/attendance-summary?course_id=${c1}`)).status).toBe(200); // 본인 배정 과정
    });

    it('S05 하위 조회의 강사 스코프: 같은 훈련생이라도 본인 미배정 과정의 출결·결과물은 보이지 않는다', async () => {
      // tConfirmed1 을 강사2 담당 과정(c2)에도 확정 등록 — 강사1은 c1 을 통해서만 이 훈련생에 접근할 수 있다
      await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, 'CONFIRMED')`, [tConfirmed1, c2]);
      await client.query(`INSERT INTO submission (trainee_id, course_id, title, submitted_at) VALUES ($1, $2, 'c1 보고서', now()), ($1, $3, 'c2 보고서', now())`, [tConfirmed1, c1, c2]);
      const ins1 = await as('ins1');
      expect((await ins1.get(`/api/v1/trainees/${tConfirmed1}/attendance-summary?course_id=${c2}`)).status).toBe(404);
      const insSubs = (await ins1.get(`/api/v1/trainees/${tConfirmed1}/submissions`).expect(200)).body.items as { courseId: number }[];
      expect(insSubs.map((s) => s.courseId)).toEqual([c1]);
      expect((await ins1.get(`/api/v1/trainees/${tConfirmed1}/submissions?course_id=${c2}`).expect(200)).body.items).toEqual([]);
      const ops1 = await as('ops');
      expect(((await ops1.get(`/api/v1/trainees/${tConfirmed1}/submissions`).expect(200)).body.items as unknown[]).length).toBe(2);
      expect((await ops1.get(`/api/v1/trainees/${tConfirmed1}/submissions?course_id=abc`)).status).toBe(400); // 형식 오류는 500 이 아니라 400
    });

    it('S05 관련 확인 건: OPS·EXEC·SYS만, INSTRUCTOR 는 403', async () => {
      const manual = await one(`SELECT rule_id id FROM detection_rule WHERE rule_code = 'MANUAL'`);
      const caseId = await one(
        `INSERT INTO verification_case (course_id, detection_rule_id, detected_at, evidence, status) VALUES ($1, $2, now(), '{"dedupe_key":"t","items":[{"id":"t"}]}', 'NEEDS_CHECK') RETURNING case_id id`,
        [c1, manual],
      );
      await client.query(`INSERT INTO verification_case_trainee (case_id, trainee_id) VALUES ($1, $2)`, [caseId, tConfirmed1]);
      const ops1 = await as('ops');
      const list = (await ops1.get(`/api/v1/trainees/${tConfirmed1}/verification-cases`).expect(200)).body;
      expect(list.items).toEqual([expect.objectContaining({ caseId, courseId: c1 })]);
      const ins1 = await as('ins1');
      expect((await ins1.get(`/api/v1/trainees/${tConfirmed1}/verification-cases`)).status).toBe(403);
    });
  });

  // ── 대시보드 ────────────────────────────────────────────────────────────
  describe('대시보드 (S01)', () => {
    it('오늘 회차·집계 카운트: date 파라미터, 종료 체크리스트 항목(1·2·4·5·6) 합산 재사용, INSTRUCTOR 는 본인 과정만', async () => {
      await one(
        `INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 98, '2020-01-01', '09:00', '10:00', $2) RETURNING schedule_id id`,
        [c1, i1],
      );
      const ops1 = await as('ops');
      const summary = (await ops1.get('/api/v1/dashboard?date=2027-01-05').expect(200)).body;
      expect(summary.todaySchedules.map((s: { scheduleId: number }) => s.scheduleId)).toEqual(expect.arrayContaining([s1, s2]));
      expect(summary.counts.notCheckedIn).toBeGreaterThanOrEqual(1); // 과거 회차 미출결
      expect(summary.counts.operationLogMissing).toBeGreaterThanOrEqual(1);
      expect(summary.counts.submissionMissing).toBeGreaterThanOrEqual(1); // tConfirmed1·2 모두 결과물 미제출

      const ins1 = await as('ins1');
      const insSummary = (await ins1.get('/api/v1/dashboard?date=2027-01-05').expect(200)).body;
      expect(insSummary.todaySchedules.map((s: { scheduleId: number }) => s.scheduleId)).toEqual([s1]); // 본인 과정(c1)만
    });

    it('확인 필요 요약: 상태별 건수 + 최근 목록(관련 훈련생 포함), INSTRUCTOR 도 본인 과정 범위로는 대시보드에서 확인 가능', async () => {
      const manual = await one(`SELECT rule_id id FROM detection_rule WHERE rule_code = 'MANUAL'`);
      const caseId = await one(
        `INSERT INTO verification_case (course_id, detection_rule_id, detected_at, evidence, status) VALUES ($1, $2, now(), '{"dedupe_key":"t","items":[{"id":"t"}]}', 'NEEDS_CHECK') RETURNING case_id id`,
        [c1, manual],
      );
      await client.query(`INSERT INTO verification_case_trainee (case_id, trainee_id) VALUES ($1, $2)`, [caseId, tConfirmed1]);
      const ops1 = await as('ops');
      const summary = (await ops1.get('/api/v1/dashboard').expect(200)).body;
      expect(summary.verificationSummary.byStatus).toEqual(expect.arrayContaining([{ status: 'NEEDS_CHECK', count: expect.any(Number) }]));
      expect(summary.verificationSummary.recent[0]).toMatchObject({ caseId, trainees: [expect.objectContaining({ traineeId: tConfirmed1 })] });
      expect(summary.verificationSummary.recent[0]).toMatchObject({ assigneeId: null, assigneeName: null });
      await client.query(`UPDATE verification_case SET assignee_id = $1 WHERE case_id = $2`, [ops, caseId]);
      const assigned = (await ops1.get('/api/v1/dashboard').expect(200)).body;
      expect(assigned.verificationSummary.recent[0]).toMatchObject({ caseId, assigneeId: ops, assigneeName: 'e2e_ops' });

      const ins1 = await as('ins1'); // c1 배정
      const insSummary = (await ins1.get('/api/v1/dashboard').expect(200)).body;
      expect(insSummary.verificationSummary.recent.some((r: { caseId: number }) => r.caseId === caseId)).toBe(true); // S22 메뉴는 미노출이지만 대시보드 요약(본인 과정)은 baseline 4-2 상 예외적으로 허용
      const ins2 = await as('ins2'); // c2 배정
      const ins2Summary = (await ins2.get('/api/v1/dashboard').expect(200)).body;
      expect(ins2Summary.verificationSummary.recent.some((r: { caseId: number }) => r.caseId === caseId)).toBe(false);
    });

    it('date 생략 시 기본값은 UTC 가 아니라 APP_TIMEZONE(기본 Asia/Seoul) 기준 오늘', async () => {
      const tz = process.env.APP_TIMEZONE ?? 'Asia/Seoul';
      const expected = (await rows(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`, [tz]))[0].d as string;
      const kstSchedule = await one(
        `INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 97, $2::date, '09:00', '10:00', $3) RETURNING schedule_id id`,
        [c1, expected, i1],
      );
      const summary = (await (await as('ops')).get('/api/v1/dashboard').expect(200)).body;
      expect(summary.date).toBe(expected);
      expect(summary.todaySchedules.map((s: { scheduleId: number }) => s.scheduleId)).toContain(kstSchedule);
    });

    it('권한: 미인증 401, course_id 필터는 해당 과정으로만 제한', async () => {
      expect((await (await as('anon')).get('/api/v1/dashboard')).status).toBe(401);
      const ops1 = await as('ops');
      const filtered = (await ops1.get(`/api/v1/dashboard?course_id=${c2}`).expect(200)).body;
      expect(filtered.todaySchedules.every((s: { courseId: number }) => s.courseId === c2)).toBe(true);
    });
  });

  // ── 일정·배정 ───────────────────────────────────────────────────────────
  describe('일정·강사 배정 (S13)', () => {
    const roundBody = (extra: object = {}) => ({ round_no: 2, class_date: '2027-01-12', start_time: '09:00', end_time: '13:00', instructor_id: i1, content: '이론', ...extra });

    it('회차 등록: 유효 배정 필요(ASSIGNMENT_REQUIRED), 중복 회차 409, 시간·강사 상태 검증, audit CREATE', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      expect((await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody({ instructor_id: i2 }))).body.code).toBe('ASSIGNMENT_REQUIRED');
      const res = (await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody()).expect(201)).body;
      expect(res).toMatchObject({ courseId: c1, roundNo: 2, classDate: '2027-01-12', startTime: '09:00:00', status: 'SCHEDULED', instructorId: i1 });
      expect((await auditSince(since)).filter((r) => r.target_table === 'class_schedule' && r.action === 'CREATE')).toHaveLength(1);
      expect((await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody())).body.code).toBe('ROUND_EXISTS');
      expect((await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody({ round_no: 3, end_time: '08:00' }))).body.code).toBe('INVALID_TIME_RANGE');
      await client.query(`UPDATE instructor SET status = 'INACTIVE' WHERE instructor_id = $1`, [i1]);
      expect((await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody({ round_no: 4 }))).body.code).toBe('INSTRUCTOR_INACTIVE');
      await client.query(`UPDATE course SET status = 'CLOSED' WHERE course_id = $1`, [c1]);
      expect((await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody({ round_no: 5 }))).body.code).toBe('COURSE_LOCKED');
      expect(await num(`SELECT count(*) n FROM class_schedule WHERE course_id = $1`, [c1])).toBe(2); // 시드 1 + 성공 1
    });

    it('회차별 배정(round_no)도 유효한 배정으로 인정한다', async () => {
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2, round_no: 3 }).expect(201);
      await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody({ round_no: 3, instructor_id: i2 })).expect(201);
      expect((await ops1.post(`/api/v1/courses/${c1}/schedules`).send(roundBody({ round_no: 4, instructor_id: i2 }))).body.code).toBe('ASSIGNMENT_REQUIRED');
    });

    it('수정·휴강: 수정은 audit before/after, 휴강은 사유 필수·CANCELLED, 휴강 후 수정·재휴강은 409', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      const res = (await ops1.patch(`/api/v1/schedules/${s1}`).send({ class_date: '2027-01-07', end_time: '17:30', content: null }).expect(200)).body;
      expect(res).toMatchObject({ classDate: '2027-01-07', endTime: '17:30:00', content: null });
      const upd = (await auditSince(since)).filter((r) => r.target_table === 'class_schedule');
      expect(upd).toHaveLength(1);
      expect(upd[0].before_value.class_date).toBe('2027-01-05');
      expect(upd[0].after_value.class_date).toBe('2027-01-07');
      expect((await ops1.patch(`/api/v1/schedules/${s1}`).send({ start_time: '19:00' })).body.code).toBe('INVALID_TIME_RANGE'); // 병합 후 검증
      expect((await ops1.post(`/api/v1/schedules/${s1}/cancel-class`).send({})).status).toBe(400);
      const cancelled = (await ops1.post(`/api/v1/schedules/${s1}/cancel-class`).send({ reason: '강사 사정' }).expect(200)).body;
      expect(cancelled.status).toBe('CANCELLED');
      const log = (await auditSince(since)).filter((r) => r.action === 'UPDATE' && r.after_value?.status === 'CANCELLED');
      expect(log).toHaveLength(1);
      expect(log[0].reason).toBe('강사 사정');
      expect((await ops1.patch(`/api/v1/schedules/${s1}`).send({ content: 'x' })).body.code).toBe('SCHEDULE_CANCELLED');
      expect((await ops1.post(`/api/v1/schedules/${s1}/cancel-class`).send({ reason: '재시도' })).body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('목록: 강사는 본인 회차만, 계산 진행완료/휴강/예정 표시, 기간·과정 필터', async () => {
      await client.query(`UPDATE class_schedule SET class_date = '2020-01-01' WHERE schedule_id = $1`, [s1]);
      const ins = (await (await as('ins1')).get('/api/v1/schedules').expect(200)).body;
      expect(ins.items).toHaveLength(1);
      expect(ins.items[0]).toMatchObject({ scheduleId: s1, displayStatus: 'COMPLETED', instructorName: '강사1', courseName: '과정1' });
      expect(JSON.stringify(ins)).not.toContain('과정2');
      const ops1 = await as('ops');
      const all = (await ops1.get('/api/v1/schedules?size=100').expect(200)).body.items;
      expect(all.find((s: { scheduleId: number }) => s.scheduleId === s2).displayStatus).toBe('SCHEDULED');
      await ops1.post(`/api/v1/schedules/${s2}/cancel-class`).send({ reason: '휴강' }).expect(200);
      expect((await ops1.get(`/api/v1/schedules?course_id=${c2}`)).body.items[0].displayStatus).toBe('CANCELLED');
      expect((await ops1.get(`/api/v1/schedules?from=2027-01-01&to=2027-12-31&course_id=${c1}`)).body.total).toBe(0);
      expect((await ops1.get('/api/v1/schedules?from=nope')).status).toBe(400);
    });

    it('목록 정렬: 과정 지정 시 회차 순, 아니면 날짜 순(system-design 3.4 진입점별 기본 정렬)', async () => {
      // 2회차를 1회차보다 이른 날짜에 둔다
      const early = await one(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 2, '2027-01-04', '09:00', '18:00', $2) RETURNING schedule_id id`, [c1, i1]);
      const ops1 = await as('ops');
      expect((await ops1.get(`/api/v1/schedules?course_id=${c1}`)).body.items.map((s: { scheduleId: number }) => s.scheduleId)).toEqual([s1, early]);
      expect((await ops1.get(`/api/v1/schedules?instructor_id=${i1}`)).body.items.map((s: { scheduleId: number }) => s.scheduleId)).toEqual([early, s1]);
    });

    it('배정: 중복 과정 전체 담당 409, 배정·취소 시 change_log(ASSIGNMENT)+audit, 취소 후 재취소 409', async () => {
      const ops1 = await as('ops');
      expect((await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2 })).body.code).toBe('ASSIGNMENT_CONFLICT'); // c1 은 이미 과정 전체 담당자 있음
      const since = await maxAudit();
      const assignment = (await ops1.post(`/api/v1/courses/${c2}/instructor-assignments`).send({ instructor_id: i1, round_no: 7 }).expect(201)).body;
      expect(assignment).toMatchObject({ instructorId: i1, courseId: c2, roundNo: 7, status: 'ASSIGNED' });
      expect((await ops1.post(`/api/v1/instructor-assignments/${assignment.assignmentId}/cancel`).send({})).status).toBe(400);
      const cancelled = (await ops1.post(`/api/v1/instructor-assignments/${assignment.assignmentId}/cancel`).send({ reason: '일정 변경' }).expect(200)).body;
      expect(cancelled.status).toBe('CANCELLED');
      const log = (await rows(`SELECT * FROM instructor_change_log WHERE entity_type = 'ASSIGNMENT' AND entity_id = $1`, [assignment.assignmentId]))[0];
      expect(log).toMatchObject({ changed_by: String(ops), reason: '일정 변경' });
      expect(log.before_value.status).toBe('ASSIGNED');
      expect(log.after_value.status).toBe('CANCELLED');
      expect((await auditSince(since)).filter((r) => r.target_table === 'instructor_assignment').map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
      expect((await ops1.post(`/api/v1/instructor-assignments/${assignment.assignmentId}/cancel`).send({ reason: '중복' })).body.code).toBe('INVALID_STATE_TRANSITION');
      expect((await ops1.post(`/api/v1/instructor-assignments/999999999/cancel`).send({ reason: 'x' })).status).toBe(404);
    });

    it('P1-02: 배정 취소 후 같은 (강사, 과정, 회차)·과정 전체 재배정은 신규 행이고 이전 취소 배정·이력이 보존된다', async () => {
      const ops1 = await as('ops');
      const first = (await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2, round_no: 3 }).expect(201)).body;
      expect((await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2, round_no: 3 })).body.code).toBe('ASSIGNMENT_CONFLICT'); // 유효 배정 중복
      await ops1.post(`/api/v1/instructor-assignments/${first.assignmentId}/cancel`).send({ reason: '일정 조정' }).expect(200);
      const second = (await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2, round_no: 3 }).expect(201)).body;
      expect(second.assignmentId).not.toBe(first.assignmentId);
      expect(second.status).toBe('ASSIGNED');
      expect((await rows('SELECT status FROM instructor_assignment WHERE assignment_id = $1', [first.assignmentId]))[0].status).toBe('CANCELLED');
      expect(await num(`SELECT count(*) n FROM instructor_change_log WHERE entity_type = 'ASSIGNMENT' AND entity_id = $1`, [first.assignmentId])).toBe(1);
      // 과정 전체 담당: 취소 후 같은 강사를 다시 배정할 수 있고, 유효한 전체 담당은 과정당 1명
      const wide = (await rows('SELECT assignment_id FROM instructor_assignment WHERE course_id = $1 AND round_no IS NULL', [c1]))[0].assignment_id;
      await ops1.post(`/api/v1/instructor-assignments/${wide}/cancel`).send({ reason: '교체' }).expect(200);
      await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i1 }).expect(201);
      expect((await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2 })).body.code).toBe('ASSIGNMENT_CONFLICT');
      expect(await num(`SELECT count(*) n FROM instructor_assignment WHERE course_id = $1 AND instructor_id = $2 AND round_no IS NULL`, [c1, i1])).toBe(2);
    });

    it('P1-06: 강사 재배정은 대상 강사에게 유효 배정이 있어야 하고 class_schedule 만 갱신한다(배정 테이블은 그대로)', async () => {
      const ops1 = await as('ops');
      expect((await ops1.post(`/api/v1/schedules/${s1}/reassign-instructor`).send({ instructor_id: i1, reason: 'x' })).body.code).toBe('SAME_INSTRUCTOR');
      expect((await ops1.post(`/api/v1/schedules/${s1}/reassign-instructor`).send({ instructor_id: i2, reason: 'x' })).body.code).toBe('ASSIGNMENT_REQUIRED'); // i2 는 c1 에 유효 배정 없음
      await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2, round_no: 1 }).expect(201);

      const since = await maxAudit();
      const res = (await ops1.post(`/api/v1/schedules/${s1}/reassign-instructor`).send({ instructor_id: i2, reason: '강사 교체' }).expect(200)).body;
      expect(res.instructorId).toBe(i2);
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'class_schedule');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'UPDATE', reason: '강사 교체' });
      expect(logs[0].before_value.instructor_id).toBe(String(i1));
      expect(logs[0].after_value.instructor_id).toBe(String(i2));
      expect(await num(`SELECT count(*) n FROM instructor_change_log WHERE entity_type = 'ASSIGNMENT'`)).toBe(0); // 배정 자체는 건드리지 않는다

      expect((await ops1.post(`/api/v1/schedules/${s1}/reassign-instructor`).send({ instructor_id: i1 })).status).toBe(400); // 사유 필수
      await client.query(`UPDATE instructor SET status = 'INACTIVE' WHERE instructor_id = $1`, [i1]);
      expect((await ops1.post(`/api/v1/schedules/${s1}/reassign-instructor`).send({ instructor_id: i1, reason: '복귀' })).body.code).toBe('INSTRUCTOR_INACTIVE');
      await ops1.post(`/api/v1/schedules/${s2}/cancel-class`).send({ reason: '휴강' }).expect(200);
      expect((await ops1.post(`/api/v1/schedules/${s2}/reassign-instructor`).send({ instructor_id: i2, reason: 'x' })).body.code).toBe('SCHEDULE_CANCELLED');
    });

    it('동일 강사·동일 시간대 회차는 경고만 반환한다(등록·재배정·수정, 휴강 회차 제외)', async () => {
      const ops1 = await as('ops');
      for (const round of [1, 2, 3]) await ops1.post(`/api/v1/courses/${c2}/instructor-assignments`).send({ instructor_id: i1, round_no: round }).expect(201);
      // s1: c1 1회차 2027-01-05 09:00~18:00 (i1)
      const overlapped = (await ops1.post(`/api/v1/courses/${c2}/schedules`).send({ round_no: 2, class_date: '2027-01-05', start_time: '13:00', end_time: '15:00', instructor_id: i1 }).expect(201)).body;
      expect(overlapped.warnings.overlappingSchedules).toEqual([expect.objectContaining({ scheduleId: s1, courseName: '과정1', roundNo: 1, startTime: '09:00:00', endTime: '18:00:00' })]);
      const adjacent = (await ops1.post(`/api/v1/courses/${c2}/schedules`).send({ round_no: 3, class_date: '2027-01-05', start_time: '18:00', end_time: '19:00', instructor_id: i1 }).expect(201)).body;
      expect(adjacent.warnings).toBeUndefined(); // 끝과 시작이 맞닿는 것은 겹침이 아니다
      const reassigned = (await ops1.post(`/api/v1/schedules/${s2}/reassign-instructor`).send({ instructor_id: i1, reason: '대강' }).expect(200)).body;
      expect(reassigned.warnings.overlappingSchedules.map((r: { scheduleId: number }) => r.scheduleId)).toEqual([s1, overlapped.scheduleId]);
      const moved = (await ops1.patch(`/api/v1/schedules/${overlapped.scheduleId}`).send({ class_date: '2027-01-06' }).expect(200)).body;
      expect(moved.warnings).toBeUndefined();
      await ops1.post(`/api/v1/schedules/${s1}/cancel-class`).send({ reason: '휴강' }).expect(200);
      const edited = (await ops1.patch(`/api/v1/schedules/${s2}`).send({ content: '실습' }).expect(200)).body;
      expect(edited.warnings).toBeUndefined(); // 휴강 회차(s1)는 겹침 대상이 아니다
    });

    it('P1-16: 배정 취소 시 예정된 회차가 남아있으면 경고를 반환한다(차단하지 않음)', async () => {
      const ops1 = await as('ops');
      const assignmentId = await one(`SELECT assignment_id id FROM instructor_assignment WHERE course_id = $1 AND instructor_id = $2 AND round_no IS NULL`, [c1, i1]);
      const res = (await ops1.post(`/api/v1/instructor-assignments/${assignmentId}/cancel`).send({ reason: '교체' }).expect(200)).body;
      expect(res.warnings).toEqual({ remainingScheduledCount: 1 }); // s1 이 아직 SCHEDULED

      const assignment2 = (await ops1.post(`/api/v1/courses/${c2}/instructor-assignments`).send({ instructor_id: i1, round_no: 9 }).expect(201)).body;
      const res2 = (await ops1.post(`/api/v1/instructor-assignments/${assignment2.assignmentId}/cancel`).send({ reason: '취소' }).expect(200)).body;
      expect(res2.warnings).toBeUndefined(); // 해당 회차(9회차)에 남은 일정 없음
    });

    it('배정 취소는 즉시 강사 과정 스코프에 반영된다(매 요청 재검사)', async () => {
      const ins = await as('ins1');
      await ins.get(`/api/v1/courses/${c1}`).expect(200);
      const assignmentId = await one(`SELECT assignment_id id FROM instructor_assignment WHERE course_id = $1`, [c1]);
      await (await as('ops')).post(`/api/v1/instructor-assignments/${assignmentId}/cancel`).send({ reason: '교체' }).expect(200);
      expect((await ins.get(`/api/v1/courses/${c1}`)).status).toBe(404);
    });
  });

  // ── 출결 (S07~S10, Phase 2) ─────────────────────────────────────────────
  describe('출결 (S07~S10)', () => {
    it('입실 확인: 확정 훈련생만 가능, 이미 존재하면 분리, 관계없는 훈련생은 notEligible, audit CREATE', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      const res = (await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1, tApplied1] }).expect(201)).body;
      expect(res.created).toHaveLength(1);
      expect(res.created[0]).toMatchObject({ traineeId: tConfirmed1, scheduleId: s1, attendanceStatus: 'PRESENT', sourceType: 'MANUAL' });
      expect(res.notEligible).toEqual([tApplied1]); // APPLIED 상태(확정 아님)
      expect((await auditSince(since)).filter((r) => r.target_table === 'attendance' && r.action === 'CREATE')).toHaveLength(1);

      const again = (await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201)).body;
      expect(again.created).toHaveLength(0);
      expect(again.alreadyExists).toEqual([{ traineeId: tConfirmed1, attendanceId: res.created[0].attendanceId }]);
      expect(await num(`SELECT count(*) n FROM attendance`)).toBe(1); // C1: 중복 생성 없음
    });

    it('강사는 본인 회차만 입실 확인 가능(타 회차 404), 결석 확정은 강사 기본 불가(403, D-07)', async () => {
      const ins1 = await as('ins1');
      expect((await ins1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201)).body.created).toHaveLength(1);
      const since = await maxAudit();
      expect((await ins1.post(`/api/v1/schedules/${s2}/attendance/check-in`).send({ trainee_ids: [tConfirmed2] })).status).toBe(404); // 타 강사 회차
      expect((await auditSince(since)).filter((r) => r.action === 'ACCESS_DENIED' && /SCOPE_VIOLATION:schedule/.test(r.reason))).toHaveLength(1);
      expect((await ins1.post(`/api/v1/schedules/${s1}/attendance/confirm-absence`).send({ trainee_ids: [tConfirmed1] })).status).toBe(403);
    });

    it('휴강 회차는 출결 기록 불가, 결석 확정은 종료·중단 과정도 거부(V7) — 입실 확인은 V7 대상이 아니다(baseline 4-3)', async () => {
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/schedules/${s2}/cancel-class`).send({ reason: '휴강' }).expect(200);
      expect((await ops1.post(`/api/v1/schedules/${s2}/attendance/check-in`).send({ trainee_ids: [tConfirmed2] })).body.code).toBe('SCHEDULE_CANCELLED');
      await client.query(`UPDATE course SET status = 'CLOSED' WHERE course_id = $1`, [c1]);
      expect((await ops1.post(`/api/v1/schedules/${s1}/attendance/confirm-absence`).send({ trainee_ids: [tConfirmed1] })).body.code).toBe('COURSE_LOCKED');
      // baseline V7 은 "결석 확정·출결 수정·과정 종료·확인 건 처리"만 과정 상태를 검증한다고 명시 — 입실 확인은 나열되어 있지 않아 여기서는 거부하지 않는다.
      expect((await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] })).status).toBe(201);
    });

    it('퇴실 확인: 최초 기록만 허용(이미 있으면 분리), change_log 없음, 스코프 밖은 존재 은닉(404 상당의 notFound)', async () => {
      const ops1 = await as('ops');
      const attendanceId = (await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201)).body.created[0].attendanceId;
      const since = await maxAudit();
      const out = (await ops1.post('/api/v1/attendance/check-out').send({ attendance_ids: [attendanceId] }).expect(200)).body;
      expect(out.updated).toHaveLength(1);
      expect(out.updated[0].checkOutTime).toBeTruthy();
      expect(await num(`SELECT count(*) n FROM attendance_change_log`)).toBe(0); // 최초 기록은 change_log 대상 아님(C1)
      expect((await auditSince(since)).filter((r) => r.target_table === 'attendance' && r.action === 'UPDATE')).toHaveLength(1);

      const again = (await ops1.post('/api/v1/attendance/check-out').send({ attendance_ids: [attendanceId] }).expect(200)).body;
      expect(again.alreadyExists).toEqual([attendanceId]);

      const ins2 = await as('ins2'); // i1 의 회차(s1) 소속이 아니므로 스코프 밖
      expect((await ins2.post('/api/v1/attendance/check-out').send({ attendance_ids: [attendanceId] })).body.notFound).toEqual([attendanceId]);
    });

    it('S07 로스터: 확정 훈련생만 표시, 미출결/상태 계산, status 필터', async () => {
      const list1 = (await (await as('ops')).get(`/api/v1/schedules/${s1}/attendance-roster`).expect(200)).body;
      expect(list1.items).toHaveLength(1); // tConfirmed1 만(tApplied1 은 확정 아님)
      expect(list1.items[0]).toMatchObject({ traineeId: tConfirmed1, attendanceId: null, displayStatus: 'NOT_CHECKED' });

      const ops1 = await as('ops');
      await ops1.post(`/api/v1/schedules/${s1}/attendance/confirm-absence`).send({ trainee_ids: [tConfirmed1] }).expect(201);
      const list2 = (await ops1.get(`/api/v1/schedules/${s1}/attendance-roster`).expect(200)).body;
      expect(list2.items[0]).toMatchObject({ displayStatus: 'ABSENT', sourceType: 'MANUAL' }); // 출처(S07 명세 열)
      expect((await ops1.get(`/api/v1/schedules/${s1}/attendance-roster?status=NOT_CHECKED`)).body.items).toHaveLength(0);
      expect((await ops1.get(`/api/v1/schedules/${s1}/attendance-roster?status=ABSENT`)).body.items).toHaveLength(1);
    });

    it('S08 매트릭스: 출석률 계산, 강사는 본인 회차 열만(타 강사 회차 제외)', async () => {
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201);
      const asOps = (await ops1.get(`/api/v1/courses/${c1}/attendance-matrix`).expect(200)).body;
      expect(asOps.items).toEqual([expect.objectContaining({ traineeId: tConfirmed1, attendanceRate: 1 })]);
      const attId = await one(`SELECT attendance_id id FROM attendance WHERE trainee_id = $1 AND schedule_id = $2`, [tConfirmed1, s1]);
      expect(asOps.items[0].cells).toEqual([{ scheduleId: s1, attendanceId: attId, displayStatus: 'PRESENT' }]); // 셀 → S09 정정 진입 키

      // 같은 과정에 다른 강사(i2)의 회차를 추가하면 ops 에는 보이지만 ins1(강사1)에는 보이지 않는다
      await ops1.post(`/api/v1/courses/${c1}/instructor-assignments`).send({ instructor_id: i2, round_no: 9 }).expect(201);
      await ops1.post(`/api/v1/courses/${c1}/schedules`).send({ round_no: 9, class_date: '2027-01-20', start_time: '09:00', end_time: '18:00', instructor_id: i2 }).expect(201);
      expect((await ops1.get(`/api/v1/courses/${c1}/attendance-matrix`)).body.schedules).toHaveLength(2);
      const asIns1 = (await (await as('ins1')).get(`/api/v1/courses/${c1}/attendance-matrix`).expect(200)).body;
      expect(asIns1.schedules).toHaveLength(1);
      expect(asIns1.schedules[0].scheduleId).toBe(s1);
    });

    it('S09 정정: 낙관적 잠금(last_modified_at)·사유 필수, 사람 정정만 change_log 기록, 강사는 조회만 가능', async () => {
      const ops1 = await as('ops');
      const attendanceId = (await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201)).body.created[0].attendanceId;
      const first = (await ops1.get(`/api/v1/attendance/${attendanceId}`).expect(200)).body;
      expect(first.lastModifiedAt).toBeNull();

      expect((await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'LATE', expected_last_modified_at: null })).status).toBe(400); // 사유 필수
      expect((await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'LATE', reason: 'x' })).status).toBe(400); // expected_last_modified_at 누락
      expect((await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'LATE', reason: 'x', expected_last_modified_at: '2020-01-01T00:00:00.000Z' })).body.code).toBe('STALE_ATTENDANCE');

      const since = await maxAudit();
      const corrected = (await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'LATE', reason: '지각 정정', expected_last_modified_at: null }).expect(200)).body;
      expect(corrected.attendanceStatus).toBe('LATE');
      expect(corrected.lastModifiedAt).toBeTruthy();
      const logs = await rows(`SELECT * FROM attendance_change_log WHERE attendance_id = $1`, [attendanceId]);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ actor_type: 'USER', changed_by: String(ops), reason: '지각 정정' });
      expect(logs[0].before_value.attendance_status).toBe('PRESENT');
      expect(logs[0].after_value.attendance_status).toBe('LATE');
      expect((await auditSince(since)).filter((r) => r.target_table === 'attendance' && r.action === 'UPDATE')).toHaveLength(1);

      expect((await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'EXCUSED', reason: 'x', expected_last_modified_at: null })).body.code).toBe('STALE_ATTENDANCE'); // 이제는 null 이 아님
      const second = (await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'EXCUSED', reason: '인정결석', expected_last_modified_at: corrected.lastModifiedAt }).expect(200)).body;
      expect(second.attendanceStatus).toBe('EXCUSED');
      expect(await num(`SELECT count(*) n FROM attendance_change_log WHERE attendance_id = $1`, [attendanceId])).toBe(2);

      const ins1 = await as('ins1');
      expect((await ins1.get(`/api/v1/attendance/${attendanceId}`).expect(200)).body.attendanceId).toBe(attendanceId);
      expect((await ins1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'PRESENT', reason: 'x', expected_last_modified_at: second.lastModifiedAt })).status).toBe(403);
      const ins2 = await as('ins2');
      expect((await ins2.get(`/api/v1/attendance/${attendanceId}`)).status).toBe(404); // 본인 회차가 아님
    });

    it('S10 변경이력: course_id·trainee_id 필터, 강사는 접근 불가', async () => {
      const ops1 = await as('ops');
      const attendanceId = (await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201)).body.created[0].attendanceId;
      await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'LATE', reason: '지각 정정', expected_last_modified_at: null }).expect(200);

      const list = (await (await as('exec')).get(`/api/v1/attendance-change-logs?course_id=${c1}`).expect(200)).body;
      expect(list.items).toEqual([expect.objectContaining({ attendanceId, traineeId: tConfirmed1, reason: '지각 정정', scheduleId: s1, roundNo: 1, classDate: '2027-01-05', courseName: '과정1' })]);
      expect((await (await as('exec')).get(`/api/v1/attendance-change-logs?trainee_name=${encodeURIComponent('확정')}`)).body.total).toBe(1); // 훈련생명 검색(S10)
      expect((await (await as('exec')).get(`/api/v1/attendance-change-logs?trainee_name=${encodeURIComponent('없는이름')}`)).body.total).toBe(0);
      expect((await (await as('exec')).get(`/api/v1/attendance-change-logs?trainee_id=${tConfirmed2}`)).body.total).toBe(0);
      expect((await (await as('ins1')).get('/api/v1/attendance-change-logs')).status).toBe(403);
    });
  });

  // ── 회차별 운영일지 (S17, Phase 2) ──────────────────────────────────────
  describe('회차별 운영일지 (S17)', () => {
    it('작성: 본인 회차만, 회차당 1건(409), 휴강 회차 거부, written_at·instructor_id 저장(Rule 03 근거)', async () => {
      const ins1 = await as('ins1');
      const since = await maxAudit();
      const created = (await ins1.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: '이론 교육 진행', participant_count: 1, issue_note: null }).expect(201)).body;
      expect(created).toMatchObject({ scheduleId: s1, instructorId: i1, content: '이론 교육 진행', participantCount: 1 });
      expect(created.writtenAt).toBeTruthy(); // RULE_03(회차 운영기록 지연) 판단 근거
      expect((await auditSince(since)).filter((r) => r.target_table === 'operation_log' && r.action === 'CREATE')).toHaveLength(1);

      expect((await ins1.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: 'dup', participant_count: 1 })).body.code).toBe('OPERATION_LOG_EXISTS');
      const ins2 = await as('ins2');
      expect((await ins2.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: 'x', participant_count: 1 })).status).toBe(404); // 본인 회차 아님

      await (await as('ops')).post(`/api/v1/schedules/${s2}/cancel-class`).send({ reason: '휴강' }).expect(200);
      expect((await ins2.post(`/api/v1/schedules/${s2}/operation-log`).send({ content: 'x', participant_count: 1 })).body.code).toBe('SCHEDULE_CANCELLED');
    });

    it('조회: 회차 목록의 미작성 계산(NOT_WRITTEN), 단일 조회 404→200, round_no 필터', async () => {
      const ops1 = await as('ops');
      const before = (await ops1.get(`/api/v1/courses/${c1}/operation-logs`).expect(200)).body;
      expect(before.items).toEqual([expect.objectContaining({ scheduleId: s1, displayStatus: 'NOT_WRITTEN', operationLogId: null, instructorName: '강사1', startTime: '09:00:00', endTime: '18:00:00' })]);
      expect((await ops1.get(`/api/v1/schedules/${s1}/operation-log`)).status).toBe(404); // 미작성

      await (await as('ins1')).post(`/api/v1/schedules/${s1}/operation-log`).send({ content: '진행', participant_count: 2 }).expect(201);
      const after = (await ops1.get(`/api/v1/courses/${c1}/operation-logs`).expect(200)).body;
      expect(after.items[0]).toMatchObject({ displayStatus: 'WRITTEN', participantCount: 2 });
      const detail = (await ops1.get(`/api/v1/schedules/${s1}/operation-log`).expect(200)).body;
      expect(detail).toMatchObject({ content: '진행', authorName: 'e2e_ins1', instructorName: '강사1', attachments: [] });
      // 첨부 목록: 저장 경로(file_path)는 내부 값이라 응답에 없다
      await client.query(`INSERT INTO attachment (entity_type, entity_id, file_name, file_path, file_size, uploaded_by) VALUES ('OPERATION_LOG', $1, '출석부.pdf', 'x-출석부.pdf', 1024, $2)`, [detail.operationLogId, insUser1]);
      const withFile = (await ops1.get(`/api/v1/schedules/${s1}/operation-log`).expect(200)).body;
      expect(withFile.attachments).toEqual([expect.objectContaining({ fileName: '출석부.pdf', fileSize: '1024' })]);
      expect(JSON.stringify(withFile.attachments)).not.toContain('x-출석부');
      expect((await ops1.get(`/api/v1/courses/${c1}/operation-logs?round_no=99`)).body.items).toHaveLength(0);
    });

    it('수정: 작성 강사 본인 또는 OPS(검수)만, audit before/after, 강사는 본인 회차 아니면 404', async () => {
      const ins1 = await as('ins1');
      const created = (await ins1.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: '초안', participant_count: 1 }).expect(201)).body;
      const since = await maxAudit();
      const updated = (await ins1.patch(`/api/v1/operation-logs/${created.operationLogId}`).send({ content: '수정본' }).expect(200)).body;
      expect(updated.content).toBe('수정본');
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'operation_log' && r.action === 'UPDATE');
      expect(logs).toHaveLength(1);
      expect(logs[0].before_value.content).toBe('초안');
      expect(logs[0].after_value.content).toBe('수정본');

      const ops1 = await as('ops');
      await ops1.patch(`/api/v1/operation-logs/${created.operationLogId}`).send({ issue_note: '검수 의견' }).expect(200); // OPS 검수 수정
      const ins2 = await as('ins2');
      expect((await ins2.patch(`/api/v1/operation-logs/${created.operationLogId}`).send({ content: 'x' })).status).toBe(404);
      expect((await ops1.patch(`/api/v1/operation-logs/${created.operationLogId}`).send({})).status).toBe(400);
    });

    it('권한: SYS_ADMIN·EXECUTIVE 는 조회만, 작성·수정 403', async () => {
      for (const who of ['sys', 'exec'] as const) {
        const agent = await as(who);
        expect((await agent.get(`/api/v1/courses/${c1}/operation-logs`)).status, who).toBe(200);
        expect((await agent.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: 'x', participant_count: 1 })).status, who).toBe(403);
      }
    });
  });

  // ── 특이사항 (S18, Phase 2) ─────────────────────────────────────────────
  describe('특이사항 (S18)', () => {
    it('등록: 강사는 본인 배정 과정만, schedule_id 는 해당 과정 소속 검증, OPS 는 전체 과정', async () => {
      const ins1 = await as('ins1');
      const created = (await ins1.post('/api/v1/course-issues').send({ course_id: c1, category: 'SAFETY', content: '안전모 부족' }).expect(201)).body;
      expect(created).toMatchObject({ courseId: c1, category: 'SAFETY', status: 'REGISTERED', reportedBy: insUser1 });
      expect((await ins1.post('/api/v1/course-issues').send({ course_id: c2, category: 'OTHER', content: 'x' })).status).toBe(404); // 본인 배정 아님

      const ops1 = await as('ops');
      expect((await ops1.post('/api/v1/course-issues').send({ course_id: c1, schedule_id: s2, category: 'FACILITY', content: 'x' })).status).toBe(400); // s2 는 c2 소속
      const withSchedule = (await ops1.post('/api/v1/course-issues').send({ course_id: c1, schedule_id: s1, category: 'FACILITY', content: '프로젝터 고장' }).expect(201)).body;
      expect(withSchedule.scheduleId).toBe(s1);
    });

    it('조회: 강사는 본인 등록 건만, OPS·EXEC 는 전체 + course_id·status 필터', async () => {
      const ins1 = await as('ins1');
      await ins1.post('/api/v1/course-issues').send({ course_id: c1, category: 'SAFETY', content: '안전모 부족' }).expect(201);
      await (await as('ops')).post('/api/v1/course-issues').send({ course_id: c1, category: 'OTHER', content: '기타 이슈' }).expect(201);

      const ins1List = (await ins1.get('/api/v1/course-issues').expect(200)).body;
      expect(ins1List.total).toBe(1);
      expect(ins1List.items[0].category).toBe('SAFETY');
      const exec1 = await as('exec');
      expect((await exec1.get('/api/v1/course-issues').expect(200)).body.total).toBe(2);
      expect((await exec1.get(`/api/v1/course-issues?course_id=${c1}&status=REGISTERED`)).body.total).toBe(2);
      expect((await exec1.get(`/api/v1/course-issues?course_id=${c2}`)).body.total).toBe(0);
    });

    it('수정·조치완료: OPS 만 가능(강사 403), 조치완료 후 재조치는 409', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post('/api/v1/course-issues').send({ course_id: c1, category: 'OTHER', content: '초안' }).expect(201)).body;
      const ins1 = await as('ins1');
      expect((await ins1.patch(`/api/v1/course-issues/${created.issueId}`).send({ content: 'x' })).status).toBe(403);
      expect((await ins1.post(`/api/v1/course-issues/${created.issueId}/resolve`)).status).toBe(403);

      const since = await maxAudit();
      const updated = (await ops1.patch(`/api/v1/course-issues/${created.issueId}`).send({ content: '수정된 내용' }).expect(200)).body;
      expect(updated.content).toBe('수정된 내용');
      const resolved = (await ops1.post(`/api/v1/course-issues/${created.issueId}/resolve`).expect(200)).body;
      expect(resolved.status).toBe('RESOLVED');
      expect((await auditSince(since)).filter((r) => r.target_table === 'course_issue' && r.action === 'UPDATE')).toHaveLength(2);
      expect((await ops1.post(`/api/v1/course-issues/${created.issueId}/resolve`)).body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('확인 필요로 전환: verification_case(MANUAL) 생성 + issue.status=IN_REVIEW, 이미 활성 건 있으면 409', async () => {
      const ops1 = await as('ops');
      const issue = (await ops1.post('/api/v1/course-issues').send({ course_id: c1, category: 'SAFETY', content: '안전모 부족' }).expect(201)).body;
      const since = await maxAudit();
      const escalated = (await ops1.post(`/api/v1/course-issues/${issue.issueId}/escalate`).send({ trainee_ids: [tConfirmed1] }).expect(201)).body;
      expect(escalated).toMatchObject({ courseId: c1, relatedCourseIssueId: issue.issueId, status: 'NEEDS_CHECK' });
      expect((await rows(`SELECT status FROM course_issue WHERE issue_id = $1`, [issue.issueId]))[0].status).toBe('IN_REVIEW');
      expect(await num(`SELECT count(*) n FROM verification_case_trainee WHERE case_id = $1`, [escalated.caseId])).toBe(1);
      expect((await auditSince(since)).filter((r) => r.target_table === 'verification_case' && r.action === 'CREATE')).toHaveLength(1);

      // 목록은 연결된 확인 건의 현재 상태를 참고 열로 준다(system-design S18)
      const listed = (await ops1.get(`/api/v1/course-issues?course_id=${c1}`).expect(200)).body.items[0];
      expect(listed).toMatchObject({ issueId: issue.issueId, courseName: '과정1', status: 'IN_REVIEW', verificationCaseId: escalated.caseId, verificationCaseStatus: 'NEEDS_CHECK' });
      expect((await ops1.post(`/api/v1/course-issues/${issue.issueId}/escalate`).send({})).body.code).toBe('VERIFICATION_CASE_EXISTS');
      const exec1 = await as('exec');
      expect((await exec1.post(`/api/v1/course-issues/${issue.issueId}/escalate`).send({})).body.code).toBe('VERIFICATION_CASE_EXISTS'); // EXEC 도 권한은 있음(baseline 4-2)
      const ins1 = await as('ins1');
      expect((await ins1.post(`/api/v1/course-issues/${issue.issueId}/escalate`).send({})).status).toBe(403); // 강사는 전환 권한 없음
    });
  });

  // ── Phase 3: 확인 필요 탐지 엔진 (RULE_01~06) ────────────────────────────
  describe('탐지 엔진 (RULE_01~06)', () => {
    const ruleId = (code: string) => one(`SELECT rule_id id FROM detection_rule WHERE rule_code = $1`, [code]);

    it('RULE_04: 퇴실정보 누락 — PRESENT/LATE·지연시간 경과만 매칭, ABSENT 는 제외, 재실행은 멱등', async () => {
      const pastSchedule = await one(
        `INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 50, '2020-01-01', '09:00', '10:00', $2) RETURNING schedule_id id`,
        [c1, i1],
      );
      const attId = await one(`INSERT INTO attendance (trainee_id, schedule_id, attendance_status, source_type) VALUES ($1, $2, 'PRESENT', 'MANUAL') RETURNING attendance_id id`, [tConfirmed1, pastSchedule]);
      const excludedSchedule = await one(
        `INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 51, '2020-01-01', '09:00', '10:00', $2) RETURNING schedule_id id`,
        [c1, i1],
      );
      await client.query(`INSERT INTO attendance (trainee_id, schedule_id, attendance_status, source_type) VALUES ($1, $2, 'ABSENT', 'MANUAL')`, [tConfirmed2, excludedSchedule]);

      const r1 = await detection.runRule04();
      expect(r1).toMatchObject({ skipped: false, casesCreated: 1, casesUpdated: 0 });
      const rid = await ruleId('RULE_04');
      const caseRow = (await rows(`SELECT case_id, course_id, status FROM verification_case WHERE detection_rule_id = $1`, [rid]))[0];
      expect(caseRow).toMatchObject({ course_id: String(c1), status: 'NEEDS_CHECK' });
      expect(await rows(`SELECT trainee_id, attendance_id FROM verification_case_trainee WHERE case_id = $1`, [caseRow.case_id])).toEqual([{ trainee_id: String(tConfirmed1), attendance_id: String(attId) }]);

      const r2 = await detection.runRule04(); // 같은 조건 재실행: 새 사건 없음, 근거도 그대로(멱등)
      expect(r2.casesCreated).toBe(0);
      expect(await num(`SELECT count(*) n FROM verification_case WHERE detection_rule_id = $1`, [rid])).toBe(1);
      const evidence = (await rows(`SELECT evidence FROM verification_case WHERE case_id = $1`, [caseRow.case_id]))[0].evidence;
      expect(evidence.items).toHaveLength(1);
    });

    it('RULE_03: 회차 운영기록 지연 — 훈련생 0명으로 생성, 운영일지 작성 후에는 더 이상 매칭되지 않음(자동 종결 아님)', async () => {
      const pastSchedule = await one(
        `INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 52, '2020-01-01', '09:00', '10:00', $2) RETURNING schedule_id id`,
        [c1, i1],
      );
      const r1 = await detection.runRule03();
      expect(r1.casesCreated).toBe(1);
      const rid = await ruleId('RULE_03');
      const caseRow = (await rows(`SELECT case_id, evidence FROM verification_case WHERE detection_rule_id = $1`, [rid]))[0];
      expect(caseRow.evidence.items).toHaveLength(1);
      expect(caseRow.evidence.items[0].schedule_id).toBe(pastSchedule);
      expect(await num(`SELECT count(*) n FROM verification_case_trainee WHERE case_id = $1`, [caseRow.case_id])).toBe(0);

      await client.query(`INSERT INTO operation_log (schedule_id, instructor_id, content, participant_count, author_id, written_at) VALUES ($1, $2, 'x', 1, $3, now())`, [pastSchedule, i1, ops]);
      const r2 = await detection.runRule03();
      expect(r2.casesCreated).toBe(0);
      expect(r2.casesUpdated).toBe(0); // 운영일지가 생겨 더 이상 조건에 맞지 않음. 기존 건은 사람이 확인해야 함(자동 종결 없음)
      expect((await rows(`SELECT status FROM verification_case WHERE case_id = $1`, [caseRow.case_id]))[0].status).toBe('NEEDS_CHECK');
    });

    it('RULE_01: 동일 환경 복수 출결 — 다중 훈련생 연결, 재실행 멱등, 새 훈련생은 기존 건에 추가(신규 건 아님)', async () => {
      await client.query(`UPDATE detection_rule SET params = '{"min_trainees":2,"window_minutes":10}' WHERE rule_code = 'RULE_01'`);
      const t2 = await one(`INSERT INTO trainee (name) VALUES ('R1-2') RETURNING trainee_id id`);
      const t3 = await one(`INSERT INTO trainee (name) VALUES ('R1-3') RETURNING trainee_id id`);
      await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, 'CONFIRMED'), ($3, $2, 'CONFIRMED')`, [t2, c1, t3]);
      const ops1 = await as('ops');
      const now = new Date().toISOString();
      await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1, t2], check_in_time: now, related_info: { device_id: 'dev-1' } }).expect(201);

      const since = await maxAudit();
      const r1 = await detection.runRule01();
      expect(r1).toMatchObject({ skipped: false, casesCreated: 1 });
      const rid = await ruleId('RULE_01');
      const caseId = (await one(`SELECT case_id id FROM verification_case WHERE detection_rule_id = $1`, [rid]));
      expect(await num(`SELECT count(*) n FROM verification_case_trainee WHERE case_id = $1`, [caseId])).toBe(2);
      // baseline 7-21행: 신규 건 생성 시점엔 verification_case 만 감사 대상(최초 훈련생 연결은 별도 감사 없음)
      expect((await auditSince(since)).filter((r) => r.target_table === 'verification_case')).toHaveLength(1);
      expect((await auditSince(since)).filter((r) => r.target_table === 'verification_case_trainee')).toHaveLength(0);

      const r2 = await detection.runRule01();
      expect(r2.casesCreated).toBe(0);
      const evidenceAfterRerun = (await rows(`SELECT evidence FROM verification_case WHERE case_id = $1`, [caseId]))[0].evidence;
      expect(evidenceAfterRerun.items).toHaveLength(1); // 근거 중복 추가 없음

      const since2 = await maxAudit();
      await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [t3], check_in_time: now, related_info: { device_id: 'dev-1' } }).expect(201);
      const r3 = await detection.runRule01();
      expect(r3.casesCreated).toBe(0); // 새 사건이 아니라 기존 건에 훈련생만 추가
      expect(await num(`SELECT count(*) n FROM verification_case WHERE detection_rule_id = $1`, [rid])).toBe(1);
      expect(await num(`SELECT count(*) n FROM verification_case_trainee WHERE case_id = $1`, [caseId])).toBe(3);
      // baseline 7-22행("확인 건 근거 추가·훈련생 추가"): 기존 활성 건에 훈련생을 추가할 때는 verification_case_trainee 도 감사 대상
      const linkAudit = (await auditSince(since2)).filter((r) => r.target_table === 'verification_case_trainee' && r.action === 'CREATE');
      expect(linkAudit).toHaveLength(1);
      expect(linkAudit[0]).toMatchObject({ actor_type: 'SYSTEM_RULE', target_id: String(caseId), reason: 'RULE_01' });
    });

    it('RULE_02: 짧은 시간 내 복수 채널 출결 — related_info.channel 로 매칭(baseline #2 확정 전 임시 필드)', async () => {
      await client.query(`UPDATE detection_rule SET params = '{"min_events":2,"window_minutes":10}' WHERE rule_code = 'RULE_02'`);
      const t2 = await one(`INSERT INTO trainee (name) VALUES ('R2-2') RETURNING trainee_id id`);
      await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, 'CONFIRMED')`, [t2, c1]);
      const ops1 = await as('ops');
      const now = new Date().toISOString();
      await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1, t2], check_in_time: now, related_info: { channel: 'kiosk-1' } }).expect(201);

      const r1 = await detection.runRule02();
      expect(r1).toMatchObject({ skipped: false, casesCreated: 1 });
      const rid = await ruleId('RULE_02');
      expect(await num(`SELECT count(*) n FROM verification_case WHERE detection_rule_id = $1`, [rid])).toBe(1);
    });

    it('RULE_05: 반복적인 출결 수정 — 사람(USER) 수정만 집계, 시스템 수정은 제외', async () => {
      await client.query(`UPDATE detection_rule SET params = '{"window_days":30,"min_changes":2}' WHERE rule_code = 'RULE_05'`);
      const attId = await one(`INSERT INTO attendance (trainee_id, schedule_id, attendance_status, source_type) VALUES ($1, $2, 'PRESENT', 'MANUAL') RETURNING attendance_id id`, [tConfirmed1, s1]);
      const ops1 = await as('ops');
      let expected: string | null = null;
      for (const status of ['LATE', 'PRESENT']) {
        const res = await ops1.post(`/api/v1/attendance/${attId}/correct`).send({ reason: '정정', expected_last_modified_at: expected, attendance_status: status }).expect(200);
        expected = res.body.lastModifiedAt as string;
      }
      await client.query(`INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, before_value, after_value, reason) VALUES ($1, $2, 'SYSTEM_BATCH', '{}', '{}', '대사')`, [attId, tConfirmed1]);

      const r1 = await detection.runRule05();
      expect(r1).toMatchObject({ skipped: false, casesCreated: 1 });
      const rid = await ruleId('RULE_05');
      const caseRow = (await rows(`SELECT case_id, evidence FROM verification_case WHERE detection_rule_id = $1`, [rid]))[0];
      expect(caseRow.evidence.items).toHaveLength(2); // SYSTEM_BATCH 수정은 제외되고 사람 수정 2건만
    });

    it('RULE_06: 출결상태 반복 변경 — 같은 상태 조합 반복만 매칭', async () => {
      await client.query(`UPDATE detection_rule SET params = '{"window_days":30,"min_flips":2}' WHERE rule_code = 'RULE_06'`);
      const attId = await one(`INSERT INTO attendance (trainee_id, schedule_id, attendance_status, source_type) VALUES ($1, $2, 'PRESENT', 'MANUAL') RETURNING attendance_id id`, [tConfirmed1, s1]);
      const ops1 = await as('ops');
      let expected: string | null = null;
      for (const status of ['ABSENT', 'PRESENT']) {
        const res = await ops1.post(`/api/v1/attendance/${attId}/correct`).send({ reason: '정정', expected_last_modified_at: expected, attendance_status: status }).expect(200);
        expected = res.body.lastModifiedAt as string;
      }
      const r1 = await detection.runRule06();
      expect(r1).toMatchObject({ skipped: false, casesCreated: 1 });
    });

    it('비활성 규칙(is_active=false)은 실행을 건너뛴다', async () => {
      await client.query(`UPDATE detection_rule SET is_active = false WHERE rule_code = 'RULE_04'`);
      const r1 = await detection.runRule04();
      expect(r1).toEqual({ skipped: true, casesCreated: 0, casesUpdated: 0 });
    });
  });

  // ── Phase 5: 탐지 규칙 회차 범위 평가 + S28 파라미터 관리 + P1-10 자동 운영중 전환 ─────────────
  describe('탐지 엔진 회차 범위 평가 (RULE_01·02 출결 이벤트용)', () => {
    it('scheduleId 를 지정하면 그 회차만 평가하고, 지정하지 않으면 전체를 평가한다', async () => {
      await client.query(`UPDATE detection_rule SET params = '{"min_trainees":2,"window_minutes":10}' WHERE rule_code = 'RULE_01'`);
      const t2 = await one(`INSERT INTO trainee (name) VALUES ('EV-2') RETURNING trainee_id id`);
      await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, 'CONFIRMED')`, [t2, c1]);
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1, t2], check_in_time: new Date().toISOString(), related_info: { device_id: 'dev-ev' } }).expect(201);

      expect(await detection.runRule01({ scheduleId: s2 })).toMatchObject({ skipped: false, casesCreated: 0, casesUpdated: 0 });
      expect(await detection.runRule01({ scheduleId: s1 })).toMatchObject({ skipped: false, casesCreated: 1 });
      expect(await detection.runRule01()).toMatchObject({ casesCreated: 0, casesUpdated: 1 }); // 전체 평가: 같은 건(멱등)
    });
  });

  describe('탐지규칙 파라미터 관리 (S28)', () => {
    const rule = async (code: string) => (await rows(`SELECT rule_id, params, is_active FROM detection_rule WHERE rule_code = $1`, [code]))[0];

    it('조회·수정은 SYS_ADMIN 만 가능하다', async () => {
      const list = await (await as('sys')).get('/api/v1/detection-rules').expect(200);
      const codes = (list.body.items as { ruleCode: string; editable: boolean }[]).map((r) => `${r.ruleCode}:${r.editable}`);
      expect(codes).toEqual(expect.arrayContaining(['RULE_01:true', 'RULE_06:true', 'MANUAL:false']));
      const r04 = await rule('RULE_04');
      for (const who of ['ops', 'exec', 'ins1'] as const) {
        expect((await (await as(who)).get('/api/v1/detection-rules')).status, who).toBe(403);
        expect((await (await as(who)).patch(`/api/v1/detection-rules/${r04.rule_id}`).send({ reason: 'x', is_active: false })).status, who).toBe(403);
      }
    });

    it('기존 키의 값만 부분 수정, 사유 필수, audit_log(UPDATE, before/after, 사유) 기록, 다음 실행부터 적용', async () => {
      const sys1 = await as('sys');
      const r04 = await rule('RULE_04');
      expect((await sys1.patch(`/api/v1/detection-rules/${r04.rule_id}`).send({ params: { delay_hours: 5 } })).status).toBe(400); // 사유 없음
      expect((await sys1.patch(`/api/v1/detection-rules/${r04.rule_id}`).send({ reason: 'x', params: { nope: 1 } })).status).toBe(400);
      expect((await sys1.patch(`/api/v1/detection-rules/${r04.rule_id}`).send({ reason: 'x', params: { delay_hours: 0 } })).status).toBe(400);
      expect((await sys1.patch(`/api/v1/detection-rules/${r04.rule_id}`).send({ reason: 'x' })).status).toBe(400); // 바꿀 값 없음

      const since = await maxAudit();
      const res = await sys1.patch(`/api/v1/detection-rules/${r04.rule_id}`).send({ reason: '실측 반영', params: { delay_hours: 5 } }).expect(200);
      expect(res.body).toMatchObject({ ruleCode: 'RULE_04', params: { delay_hours: 5 }, isActive: true });
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'detection_rule');
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'UPDATE', actor_type: 'USER', actor_user_id: String(sys), reason: '실측 반영', target_id: String(r04.rule_id) });
      expect(logs[0].before_value.params).toEqual({ delay_hours: 2 });
      expect(logs[0].after_value.params).toEqual({ delay_hours: 5 });

      await sys1.patch(`/api/v1/detection-rules/${r04.rule_id}`).send({ reason: '일시 중지', is_active: false }).expect(200);
      expect(await detection.runRule04()).toEqual({ skipped: true, casesCreated: 0, casesUpdated: 0 });
    });

    it('MANUAL 은 수정할 수 없다(409), 없는 규칙은 404', async () => {
      const sys1 = await as('sys');
      const manual = await rule('MANUAL');
      expect((await sys1.patch(`/api/v1/detection-rules/${manual.rule_id}`).send({ reason: 'x', is_active: false })).body).toMatchObject({ code: 'RULE_NOT_EDITABLE' });
      expect((await sys1.patch(`/api/v1/detection-rules/999999999`).send({ reason: 'x', is_active: false })).status).toBe(404);
    });
  });

  describe('과정 자동 운영중 전환 배치 (P1-10)', () => {
    let courses: CourseService;
    beforeAll(() => {
      courses = app.get(CourseService);
    });
    const newCourse = (name: string, status: string) =>
      one(`INSERT INTO course (course_name, start_date, end_date, total_hours, training_site, manager_user_id, status) VALUES ($1, '2027-01-01', '2027-03-31', 100, '본원', $2, $3) RETURNING course_id id`, [name, ops, status]);
    const addSchedule = (course: number, round: number, date: string, status = 'SCHEDULED') =>
      client.query(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id, status) VALUES ($1, $2, $3, '09:00', '18:00', $4, $5)`, [course, round, date, i1, status]);
    const confirm = async (course: number) => {
      const t = await one(`INSERT INTO trainee (name) VALUES ('AS') RETURNING trainee_id id`);
      await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id, status) VALUES ($1, $2, 'CONFIRMED')`, [t, course]);
    };
    const status = async (course: number) => (await rows(`SELECT status FROM course WHERE course_id = $1`, [course]))[0].status;

    it('첫 교육일 도래 + 확정 훈련생 ≥ 1 인 준비중·모집중 과정만 SYSTEM_BATCH 로 전환하고, 재실행은 멱등', async () => {
      const due1 = await newCourse('자동-준비중', 'PREPARING');
      await addSchedule(due1, 1, '2027-01-05');
      await confirm(due1);
      const due2 = await newCourse('자동-모집중', 'RECRUITING');
      await addSchedule(due2, 1, '2027-01-04');
      await addSchedule(due2, 2, '2027-01-20');
      await confirm(due2);
      const noTrainee = await newCourse('확정 없음', 'RECRUITING');
      await addSchedule(noTrainee, 1, '2027-01-05');
      const notYet = await newCourse('첫 교육일 전', 'PREPARING');
      await addSchedule(notYet, 1, '2027-01-06');
      await confirm(notYet);
      const onlyCancelled = await newCourse('휴강만', 'PREPARING');
      await addSchedule(onlyCancelled, 1, '2027-01-05', 'CANCELLED');
      await addSchedule(onlyCancelled, 2, '2027-01-10');
      await confirm(onlyCancelled);
      const suspended = await newCourse('중단', 'SUSPENDED');
      await addSchedule(suspended, 1, '2027-01-01');
      await confirm(suspended);

      const since = await maxAudit();
      const r1 = await courses.autoStartDue('2027-01-05');
      expect(r1).toEqual({ date: '2027-01-05', started: [due1, due2], failed: [] });
      expect(await status(due1)).toBe('IN_PROGRESS');
      expect(await status(due2)).toBe('IN_PROGRESS');
      for (const c of [noTrainee, notYet, onlyCancelled]) expect(await status(c)).not.toBe('IN_PROGRESS');
      expect(await status(suspended)).toBe('SUSPENDED');

      const logs = (await auditSince(since)).filter((r) => r.target_table === 'course');
      expect(logs).toHaveLength(2); // 상태를 바꾼 건만 기록(baseline 7절 #32)
      for (const log of logs) {
        expect(log).toMatchObject({ action: 'UPDATE', actor_type: 'SYSTEM_BATCH', actor_user_id: null, reason: 'batch:course-auto-start' });
        expect(log.after_value.status).toBe('IN_PROGRESS');
      }

      const r2 = await courses.autoStartDue('2027-01-05');
      expect(r2.started).toEqual([]);
      expect((await auditSince(since)).filter((r) => r.target_table === 'course')).toHaveLength(2);
    });

    it('기준일을 생략하면 APP_TIMEZONE 기준 오늘로 판정한다', async () => {
      const r = await courses.autoStartDue();
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.failed).toEqual([]);
    });
  });

  // ── Phase 3: 확인 필요 목록·상세·조치이력 (S22~S24) ──────────────────────
  describe('확인 필요 목록·상세·조치이력 (S22~S24)', () => {
    const makeCase = async (courseId: number, status = 'NEEDS_CHECK') => {
      const manual = await one(`SELECT rule_id id FROM detection_rule WHERE rule_code = 'MANUAL'`);
      return one(
        `INSERT INTO verification_case (course_id, detection_rule_id, detected_at, evidence, status) VALUES ($1, $2, now(), '{"dedupe_key":"t","items":[{"id":"t"}]}', $3) RETURNING case_id id`,
        [courseId, manual, status],
      );
    };

    it('S22 목록: course_id·status·rule_code 필터, priority 계산값, 관련 훈련생 포함', async () => {
      const caseId = await makeCase(c1, 'PRIORITY_CHECK');
      await client.query(`INSERT INTO verification_case_trainee (case_id, trainee_id) VALUES ($1, $2)`, [caseId, tConfirmed1]);
      await makeCase(c2);
      const ops1 = await as('ops');
      const list = (await ops1.get('/api/v1/verification-cases').expect(200)).body;
      expect(list.total).toBe(2);
      const item = list.items.find((i: { caseId: number }) => i.caseId === caseId);
      expect(item).toMatchObject({ priority: true, status: 'PRIORITY_CHECK' });
      expect(item.trainees).toEqual([expect.objectContaining({ traineeId: tConfirmed1 })]);
      expect((await ops1.get(`/api/v1/verification-cases?course_id=${c1}`).expect(200)).body.total).toBe(1);
      expect((await ops1.get(`/api/v1/verification-cases?status=PRIORITY_CHECK`).expect(200)).body.total).toBe(1);
      expect((await ops1.get(`/api/v1/verification-cases?rule_code=MANUAL`).expect(200)).body.total).toBe(2);
      // 발생일 범위(from·to, KST 기준): 오늘 생성된 건은 오늘~오늘 범위에 들고, 미래 범위에는 없다
      const todayKst = (await rows(`SELECT to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') d`))[0].d as string;
      expect((await ops1.get(`/api/v1/verification-cases?course_id=${c1}&from=${todayKst}&to=${todayKst}`).expect(200)).body.total).toBe(1);
      expect((await ops1.get(`/api/v1/verification-cases?course_id=${c1}&from=2999-01-01`).expect(200)).body.total).toBe(0);
      expect((await ops1.get(`/api/v1/verification-cases?course_id=${c1}&to=2000-01-01`).expect(200)).body.total).toBe(0);
      expect((await ops1.get(`/api/v1/verification-cases?from=bad`)).status).toBe(400);
    });

    it('S22 담당자 배정: 일괄 배정, 존재하지 않는 건은 notFound', async () => {
      const c = await makeCase(c1);
      const ops1 = await as('ops');
      const res = (await ops1.post('/api/v1/verification-cases/assign').send({ case_ids: [c, 999999], assignee_id: ops }).expect(200)).body;
      expect(res).toMatchObject({ updated: 1, notFound: [999999] });
      expect((await rows(`SELECT assignee_id FROM verification_case WHERE case_id = $1`, [c]))[0].assignee_id).toBe(String(ops));
    });

    it('S23 상세: evidence·관련 훈련생·회차 링크·처리 이력 포함', async () => {
      const manual = await one(`SELECT rule_id id FROM detection_rule WHERE rule_code = 'MANUAL'`);
      const c = await one(
        `INSERT INTO verification_case (course_id, detection_rule_id, detected_at, evidence, status) VALUES ($1, $2, now(), $3, 'NEEDS_CHECK') RETURNING case_id id`,
        [c1, manual, JSON.stringify({ dedupe_key: 't', items: [{ id: 't', schedule_id: s1 }] })],
      );
      await client.query(`INSERT INTO verification_case_trainee (case_id, trainee_id) VALUES ($1, $2)`, [c, tConfirmed1]);
      const ops1 = await as('ops');
      const detail = (await ops1.get(`/api/v1/verification-cases/${c}`).expect(200)).body;
      expect(detail.evidence.items[0].schedule_id).toBe(s1); // evidence 는 JSON 그대로 저장(toApi 는 최상위 키만 camelCase)
      expect(detail.trainees).toEqual([expect.objectContaining({ traineeId: tConfirmed1 })]);
      expect(detail.schedules).toEqual([expect.objectContaining({ scheduleId: s1 })]);
      expect(detail.actionLogs).toEqual([]);
      expect(detail).toMatchObject({ assigneeId: null, assigneeName: null });
      await client.query(`UPDATE verification_case SET assignee_id = $1 WHERE case_id = $2`, [ops, c]);
      expect((await ops1.get(`/api/v1/verification-cases/${c}`).expect(200)).body).toMatchObject({ assigneeId: ops, assigneeName: 'e2e_ops' });
      expect((await ops1.get('/api/v1/verification-cases/999999')).status).toBe(404);
    });

    it('S23 상태 전이: 확인 시작→확인완료, 확인 시작→조치필요→조치완료, 재오픈, 각 단계는 action_log 기록, 잘못된 전이는 409', async () => {
      const c = await makeCase(c1);
      const ops1 = await as('ops');
      const since = await maxAudit();

      expect((await ops1.post(`/api/v1/verification-cases/${c}/complete-confirmation`).send({})).body.code).toBe('INVALID_STATE_TRANSITION'); // NEEDS_CHECK 에서 바로 종결 불가
      expect((await ops1.post(`/api/v1/verification-cases/${c}/start-review`).send({})).status).toBe(400); // confirmation_note 필수

      const reviewed = (await ops1.post(`/api/v1/verification-cases/${c}/start-review`).send({ confirmation_note: '근거 확인 중' }).expect(200)).body;
      expect(reviewed.status).toBe('IN_REVIEW');
      const confirmed = (await ops1.post(`/api/v1/verification-cases/${c}/complete-confirmation`).send({}).expect(200)).body;
      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.closedAt).toBeTruthy();
      expect(confirmed.confirmationNote).toBe('근거 확인 중'); // 종결 시 메모를 생략하면 확인 시작 때 적은 내용을 지우지 않는다

      const logs = (await rows(`SELECT action_type, previous_status, new_status FROM verification_action_log WHERE case_id = $1 ORDER BY log_id`, [c]));
      expect(logs).toEqual([
        { action_type: 'CHECK', previous_status: 'NEEDS_CHECK', new_status: 'IN_REVIEW' },
        { action_type: 'CLOSE', previous_status: 'IN_REVIEW', new_status: 'CONFIRMED' },
      ]);
      expect((await auditSince(since)).filter((r) => r.target_table === 'verification_case' && r.action === 'UPDATE')).toHaveLength(2);

      const reopened = (await ops1.post(`/api/v1/verification-cases/${c}/reopen`).send({ reason: '추가 제보' }).expect(200)).body;
      expect(reopened.status).toBe('FOLLOW_UP');
      await ops1.post(`/api/v1/verification-cases/${c}/start-review`).send({ confirmation_note: '재확인' }).expect(200);
      const actionRequired = (await ops1.post(`/api/v1/verification-cases/${c}/require-action`).send({ action_note: '현장 지도 필요' }).expect(200)).body;
      expect(actionRequired.status).toBe('ACTION_REQUIRED');
      const actionDone = (await ops1.post(`/api/v1/verification-cases/${c}/complete-action`).send({}).expect(200)).body;
      expect(actionDone.status).toBe('ACTION_DONE');
      expect(actionDone.actionNote).toBe('현장 지도 필요'); // 조치 완료 시 메모를 생략하면 조치 필요 때 적은 내용을 유지
      expect((await ops1.post(`/api/v1/verification-cases/${c}/complete-action`).send({})).body.code).toBe('INVALID_STATE_TRANSITION'); // 이미 종결
    });

    it('S24 조치이력: course_id·action_type 필터', async () => {
      const c = await makeCase(c1);
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/verification-cases/${c}/start-review`).send({ confirmation_note: 'x' }).expect(200);
      await ops1.post(`/api/v1/verification-cases/${c}/complete-confirmation`).send({}).expect(200);
      const list = (await ops1.get(`/api/v1/verification-action-logs?course_id=${c1}`).expect(200)).body;
      expect(list.total).toBe(2);
      expect((await ops1.get(`/api/v1/verification-action-logs?course_id=${c1}&action_type=CLOSE`).expect(200)).body.total).toBe(1);
      expect((await ops1.get(`/api/v1/verification-action-logs?course_id=${c2}`).expect(200)).body.total).toBe(0);
    });

    it('권한: INSTRUCTOR 는 S22~S24 전면 접근 불가(메뉴 미노출), SYS_ADMIN 은 조회만', async () => {
      const c = await makeCase(c1);
      const ins1 = await as('ins1');
      expect((await ins1.get('/api/v1/verification-cases')).status).toBe(403);
      expect((await ins1.get(`/api/v1/verification-cases/${c}`)).status).toBe(403);
      expect((await ins1.post('/api/v1/verification-cases/assign').send({ case_ids: [c], assignee_id: ops })).status).toBe(403);
      expect((await ins1.get('/api/v1/verification-action-logs')).status).toBe(403);
      const sysAgent = await as('sys');
      expect((await sysAgent.get('/api/v1/verification-cases')).status).toBe(200);
      expect((await sysAgent.post(`/api/v1/verification-cases/${c}/start-review`).send({ confirmation_note: 'x' })).status).toBe(403);
    });
  });

  // ── 결과물 (S19~S21, Phase 3 잔여) ────────────────────────────────────────
  describe('결과물 (S19~S21)', () => {
    it('등록: OPS만, 확정 훈련생만 가능, 항상 SUBMITTED로 생성, 중복(trainee·course·title)은 409', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      const created = (await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서1', submitted_at: '2027-01-10T00:00:00Z' }).expect(201)).body;
      expect(created).toMatchObject({ traineeId: tConfirmed1, courseId: c1, title: '보고서1', version: 1, submitStatus: 'SUBMITTED', reviewStatus: 'PENDING' });
      expect((await auditSince(since)).filter((r) => r.target_table === 'submission' && r.action === 'CREATE')).toHaveLength(1);

      expect((await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tApplied1, title: 'x', submitted_at: '2027-01-10T00:00:00Z' })).status).toBe(400); // 확정 아님
      expect((await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서1', submitted_at: '2027-01-11T00:00:00Z' })).body.code).toBe('SUBMISSION_EXISTS');

      const ins1 = await as('ins1');
      expect((await ins1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서2', submitted_at: '2027-01-10T00:00:00Z' })).status).toBe(403);
    });

    it('제출현황: 미제출 계산(NOT_SUBMITTED), missing_only·review_status 필터, INSTRUCTOR 는 본인 배정 과정만', async () => {
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서', submitted_at: '2027-01-10T00:00:00Z' }).expect(201);

      const status = (await ops1.get(`/api/v1/courses/${c1}/submission-status`).expect(200)).body;
      expect(status.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ traineeId: tConfirmed1, displayStatus: 'SUBMITTED', title: '보고서' }),
        ]),
      );
      // 등록일시·등록자는 audit_log CREATE 기록에서(submission 에는 감사 컬럼이 없다), 연락처는 마스킹
      expect(status.items[0]).toMatchObject({ registeredByName: 'e2e_ops', contact: '***-****-8888' });
      expect(status.items[0].registeredAt).toBeTruthy();
      expect(JSON.stringify(status)).not.toContain('010-9999-8888');

      const missing = (await ops1.get(`/api/v1/courses/${c1}/submission-status?missing_only=true`).expect(200)).body;
      expect(missing.items).toEqual([]); // 확정 훈련생은 tConfirmed1 뿐이고 이미 제출함

      const reviewFiltered = (await ops1.get(`/api/v1/courses/${c1}/submission-status?review_status=APPROVED`).expect(200)).body;
      expect(reviewFiltered.items).toEqual([]); // 아직 검토 전(PENDING)

      const ins1 = await as('ins1');
      expect((await ins1.get(`/api/v1/courses/${c1}/submission-status`)).status).toBe(200); // 본인 배정 과정(c1)
      expect((await ins1.get(`/api/v1/courses/${c2}/submission-status`)).status).toBe(404); // 본인 배정 아님
    });

    it('재등록: version 증가, review_status=PENDING 초기화, OPS만 가능', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서', submitted_at: '2027-01-10T00:00:00Z' }).expect(201)).body;
      await ops1.post(`/api/v1/submissions/${created.submissionId}/reviews`).send({ review_result: 'APPROVED' }).expect(201);

      const since = await maxAudit();
      const reReg = (await ops1.post(`/api/v1/submissions/${created.submissionId}/re-register`).send({ submitted_at: '2027-01-15T00:00:00Z' }).expect(200)).body;
      expect(reReg).toMatchObject({ version: 2, reviewStatus: 'PENDING' });
      expect((await auditSince(since)).filter((r) => r.target_table === 'submission' && r.action === 'UPDATE')).toHaveLength(1);

      const ins1 = await as('ins1');
      expect((await ins1.post(`/api/v1/submissions/${created.submissionId}/re-register`).send({ submitted_at: '2027-01-16T00:00:00Z' })).status).toBe(403);
    });

    it('검토: submission_review_log 누적 + submission.review_status 갱신, S21은 INSTRUCTOR 전면 불가, EXECUTIVE는 읽기만', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서', submitted_at: '2027-01-10T00:00:00Z' }).expect(201)).body;

      const ins1 = await as('ins1');
      expect((await ins1.get(`/api/v1/submissions/${created.submissionId}`)).status).toBe(403);
      const exec1 = await as('exec');
      expect((await exec1.get(`/api/v1/submissions/${created.submissionId}`).expect(200)).body.title).toBe('보고서');
      expect((await exec1.post(`/api/v1/submissions/${created.submissionId}/reviews`).send({ review_result: 'APPROVED' })).status).toBe(403);

      const since = await maxAudit();
      const reviewed = (await ops1.post(`/api/v1/submissions/${created.submissionId}/reviews`).send({ review_result: 'REVISION_REQUESTED', review_comment: '표지 보완 필요' }).expect(201)).body;
      expect(reviewed.reviewStatus).toBe('REVISION_REQUESTED');
      expect(reviewed.review).toMatchObject({ reviewResult: 'REVISION_REQUESTED', reviewComment: '표지 보완 필요', version: 1 });
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'submission_review_log' && r.action === 'CREATE');
      expect(logs).toHaveLength(1);
      expect((await auditSince(since)).filter((r) => r.target_table === 'submission' && r.action === 'UPDATE')).toHaveLength(1);

      const detail = (await ops1.get(`/api/v1/submissions/${created.submissionId}`).expect(200)).body;
      expect(detail.reviews).toEqual([expect.objectContaining({ reviewResult: 'REVISION_REQUESTED' })]);
      expect(detail).toMatchObject({ traineeName: '확정1', courseName: '과정1' });
    });

    it('S05 훈련생 상세: 본인 제출 결과물 목록, course_id 필터', async () => {
      const ops1 = await as('ops');
      await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서', submitted_at: '2027-01-10T00:00:00Z' }).expect(201);
      const list = (await ops1.get(`/api/v1/trainees/${tConfirmed1}/submissions`).expect(200)).body;
      expect(list.items).toEqual([expect.objectContaining({ courseId: c1, title: '보고서' })]);
      expect((await ops1.get(`/api/v1/trainees/${tConfirmed1}/submissions?course_id=${c2}`).expect(200)).body.items).toEqual([]);
    });
  });

  // ── 첨부파일 업로드·다운로드 (S17·S18·S19 공용, 현재 SUBMISSION만 지원) ──
  describe('첨부파일 (attachment)', () => {
    it('업로드: OPS만, entity_version 미지정 시 현재 버전 사용, 다운로드는 VIEW_SENSITIVE 기록', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서', submitted_at: '2027-01-10T00:00:00Z' }).expect(201)).body;

      const since = await maxAudit();
      const uploaded = (
        await ops1
          .post('/api/v1/attachments')
          .field('entity_type', 'SUBMISSION')
          .field('entity_id', String(created.submissionId))
          .attach('file', Buffer.from('hello world'), 'report.txt')
          .expect(201)
      ).body;
      expect(uploaded).toMatchObject({ entityType: 'SUBMISSION', entityId: created.submissionId, entityVersion: 1, fileName: 'report.txt', fileSize: '11' }); // file_size 는 BIGINT(toApi 는 *_size 를 숫자로 변환하지 않음)
      expect((await auditSince(since)).filter((r) => r.target_table === 'attachment' && r.action === 'CREATE')).toHaveLength(1);

      const ins1 = await as('ins1');
      expect(
        (
          await ins1
            .post('/api/v1/attachments')
            .field('entity_type', 'SUBMISSION')
            .field('entity_id', String(created.submissionId))
            .attach('file', Buffer.from('x'), 'x.txt')
        ).status,
      ).toBe(403); // S19:C 는 OPS 전용

      const dlSince = await maxAudit();
      const dl = await ops1.get(`/api/v1/attachments/${uploaded.attachmentId}/download`).expect(200);
      expect(dl.headers['content-disposition']).toContain('report.txt');
      const viewLogs = (await auditSince(dlSince)).filter((r) => r.target_table === 'attachment' && r.action === 'VIEW_SENSITIVE');
      expect(viewLogs).toHaveLength(1);

      expect((await ops1.get('/api/v1/attachments/999999/download')).status).toBe(404);
    });

    it('한글 파일명이 깨지지 않는다(multipart filename 을 UTF-8 로 해석)', async () => {
      const ins1 = await as('ins1');
      const log = (await ins1.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: '진행', participant_count: 1 }).expect(201)).body;
      const uploaded = (
        await ins1.post('/api/v1/attachments').field('entity_type', 'OPERATION_LOG').field('entity_id', String(log.operationLogId)).attach('file', Buffer.from('x'), '출석부 사진.png').expect(201)
      ).body;
      expect(uploaded.fileName).toBe('출석부 사진.png');
      const dl = await ins1.get(`/api/v1/attachments/${uploaded.attachmentId}/download`).expect(200);
      expect(decodeURIComponent(dl.headers['content-disposition'])).toContain('출석부 사진.png');
    });

    it('업로드: 허용되지 않는 entity_type 값은 400', async () => {
      const ops1 = await as('ops');
      expect((await ops1.post('/api/v1/attachments').field('entity_type', 'BOGUS').field('entity_id', '1').attach('file', Buffer.from('x'), 'x.txt')).status).toBe(400);
    });

    it('업로드: OPERATION_LOG — 작성 강사(C) 또는 OPS 검수(U) 모두 가능, 본인 회차 아니면 404', async () => {
      const ins1 = await as('ins1');
      const log = (await ins1.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: '진행', participant_count: 1 }).expect(201)).body;
      const uploaded = (
        await ins1.post('/api/v1/attachments').field('entity_type', 'OPERATION_LOG').field('entity_id', String(log.operationLogId)).attach('file', Buffer.from('x'), 'photo.jpg').expect(201)
      ).body;
      expect(uploaded).toMatchObject({ entityType: 'OPERATION_LOG', entityId: log.operationLogId, entityVersion: null });

      const ops1 = await as('ops');
      await ops1.post('/api/v1/attachments').field('entity_type', 'OPERATION_LOG').field('entity_id', String(log.operationLogId)).attach('file', Buffer.from('x'), 'note.txt').expect(201); // OPS 는 S17:U 로 허용

      const ins2 = await as('ins2'); // s1 은 강사1 회차, 강사2는 본인 회차 아님
      expect((await ins2.post('/api/v1/attachments').field('entity_type', 'OPERATION_LOG').field('entity_id', String(log.operationLogId)).attach('file', Buffer.from('x'), 'x.txt')).status).toBe(404);

      const dl = await ops1.get(`/api/v1/attachments/${uploaded.attachmentId}/download`).expect(200);
      expect(dl.headers['content-disposition']).toContain('photo.jpg');
    });

    it('업로드·다운로드: COURSE_ISSUE — 강사는 본인 배정 과정에만 업로드, 다운로드는 "본인 등록 건"만(baseline 4-2)', async () => {
      const ins1 = await as('ins1');
      const ownIssue = (await ins1.post('/api/v1/course-issues').send({ course_id: c1, category: 'SAFETY', content: 'x' }).expect(201)).body;
      const ownUploaded = (
        await ins1.post('/api/v1/attachments').field('entity_type', 'COURSE_ISSUE').field('entity_id', String(ownIssue.issueId)).attach('file', Buffer.from('x'), 'evidence.jpg').expect(201)
      ).body;

      const ops1 = await as('ops');
      const opsIssue = (await ops1.post('/api/v1/course-issues').send({ course_id: c1, category: 'OTHER', content: 'y' }).expect(201)).body; // reported_by=ops
      const opsUploaded = (
        await ops1.post('/api/v1/attachments').field('entity_type', 'COURSE_ISSUE').field('entity_id', String(opsIssue.issueId)).attach('file', Buffer.from('x'), 'w.txt').expect(201)
      ).body;

      expect((await ins1.get(`/api/v1/attachments/${ownUploaded.attachmentId}/download`)).status).toBe(200); // 본인 등록 건
      expect((await ins1.get(`/api/v1/attachments/${opsUploaded.attachmentId}/download`)).status).toBe(404); // 타인(OPS) 등록 건
      expect((await ops1.get(`/api/v1/attachments/${ownUploaded.attachmentId}/download`)).status).toBe(200); // OPS 는 전체 조회
    });

    it('다운로드: 본인 배정 과정이 아닌 강사는 접근 불가(404)', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: '보고서', submitted_at: '2027-01-10T00:00:00Z' }).expect(201)).body;
      const uploaded = (
        await ops1.post('/api/v1/attachments').field('entity_type', 'SUBMISSION').field('entity_id', String(created.submissionId)).attach('file', Buffer.from('x'), 'x.txt').expect(201)
      ).body;
      const ins2 = await as('ins2'); // c2 배정, c1 아님
      expect((await ins2.get(`/api/v1/attachments/${uploaded.attachmentId}/download`)).status).toBe(404);
    });
  });

  // ── 권한 관리 (S26) ─────────────────────────────────────────────────────
  describe('권한 관리 (S26)', () => {
    it('조회는 role_id 필수, 저장은 전체 교체(before/after 1건)이며 즉시 적용된다', async () => {
      const sysAgent = await as('sys');
      expect((await sysAgent.get('/api/v1/roles/permissions')).status).toBe(400); // role_id 필수
      expect((await sysAgent.get('/api/v1/roles/permissions?role_id=999999999')).status).toBe(404);
      const instructorRoleId = await one(`SELECT role_id id FROM role WHERE role_code = 'INSTRUCTOR'`);
      const before = (await sysAgent.get(`/api/v1/roles/permissions?role_id=${instructorRoleId}`).expect(200)).body;
      expect(before.items).toEqual(expect.arrayContaining([{ screenId: 'S05', action: 'R', scope: 'OWN_ASSIGNED' }]));

      const ins = await as('ins1');
      await ins.get(`/api/v1/trainees/${tConfirmed1}`).expect(200); // 변경 전: S05 접근 가능

      const newItems = before.items.filter((i: { screenId: string }) => i.screenId !== 'S05'); // S05(R) 회수
      const since = await maxAudit();
      const replaced = (await sysAgent.put(`/api/v1/roles/${instructorRoleId}/permissions`).send({ items: newItems }).expect(200)).body;
      expect(replaced.items.some((i: { screenId: string }) => i.screenId === 'S05')).toBe(false);
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'role_permission');
      expect(logs).toHaveLength(1); // 개별 행이 아니라 매트릭스 전체가 한 건
      expect(logs[0]).toMatchObject({ action: 'UPDATE', target_id: String(instructorRoleId) });
      expect(logs[0].before_value).toEqual(expect.arrayContaining([expect.objectContaining({ screen_id: 'S05', action: 'R' })]));
      expect(logs[0].after_value.some((r: { screen_id: string }) => r.screen_id === 'S05')).toBe(false);

      expect((await ins.get(`/api/v1/trainees/${tConfirmed1}`)).status).toBe(403); // 캐시 없이 즉시 반영(V1)

      expect((await sysAgent.put(`/api/v1/roles/${instructorRoleId}/permissions`).send({ items: [{ screenId: 'S99', action: 'R' }] })).status).toBe(400);
      expect((await sysAgent.put(`/api/v1/roles/${instructorRoleId}/permissions`).send({ items: [{ screenId: 'S05', action: 'R' }, { screenId: 'S05', action: 'R' }] })).status).toBe(400);
      expect(await num(`SELECT count(*) n FROM role_permission WHERE role_id = $1 AND screen_id = 'S05'`, [instructorRoleId])).toBe(0); // 검증 실패는 저장되지 않음

      await sysAgent.put(`/api/v1/roles/${instructorRoleId}/permissions`).send({ items: before.items }).expect(200); // 복원
      expect((await ins.get(`/api/v1/trainees/${tConfirmed1}`)).status).toBe(200);
    });

    it('역할 목록(S26 역할 선택용), 시스템 관리자 역할에서 S26 조회·저장을 빼면 409(잠금 방지)', async () => {
      const sysAgent = await as('sys');
      const roles = (await sysAgent.get('/api/v1/roles').expect(200)).body.items;
      expect(roles.map((r: { roleCode: string }) => r.roleCode).sort()).toEqual(['EXECUTIVE', 'INSTRUCTOR', 'OPS_MANAGER', 'SYS_ADMIN']);
      expect(roles[0]).toEqual(expect.objectContaining({ roleId: expect.any(Number), roleName: expect.any(String) }));
      expect((await (await as('ops')).get('/api/v1/roles')).status).toBe(403);

      const sysRoleId = roles.find((r: { roleCode: string }) => r.roleCode === 'SYS_ADMIN').roleId;
      const current = (await sysAgent.get(`/api/v1/roles/permissions?role_id=${sysRoleId}`).expect(200)).body.items;
      const withoutS26U = current.filter((i: { screenId: string; action: string }) => !(i.screenId === 'S26' && i.action === 'U'));
      expect((await sysAgent.put(`/api/v1/roles/${sysRoleId}/permissions`).send({ items: withoutS26U })).body.code).toBe('SELF_LOCKOUT');
      expect(await num(`SELECT count(*) n FROM role_permission WHERE role_id = $1 AND screen_id = 'S26'`, [sysRoleId])).toBe(2); // 그대로
      const withoutS25 = current.filter((i: { screenId: string }) => i.screenId !== 'S25'); // S26 이 남아 있으면 다른 조정은 허용
      await sysAgent.put(`/api/v1/roles/${sysRoleId}/permissions`).send({ items: withoutS25 }).expect(200);
    });

    it('SYS_ADMIN 외 역할은 조회·저장 모두 403', async () => {
      const instructorRoleId = await one(`SELECT role_id id FROM role WHERE role_code = 'INSTRUCTOR'`);
      for (const who of ['ops', 'exec', 'ins1'] as const) {
        const agent = await as(who);
        expect((await agent.get(`/api/v1/roles/permissions?role_id=${instructorRoleId}`)).status, who).toBe(403);
        expect((await agent.put(`/api/v1/roles/${instructorRoleId}/permissions`).send({ items: [] })).status, who).toBe(403);
      }
    });
  });

  // ── 감사로그 (S27) ──────────────────────────────────────────────────────
  describe('감사로그 조회 (S27)', () => {
    it('from·to 필수, 최대 범위 제한, 조회 자체가 VIEW_SENSITIVE 로 스스로 기록된다', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post('/api/v1/courses').send({ course_name: '감사조회용', start_date: '2027-01-01', end_date: '2027-01-31', total_hours: 10, training_site: 'x', manager_user_id: ops }).expect(201)).body;

      const sysAgent = await as('sys');
      expect((await sysAgent.get('/api/v1/audit-logs')).status).toBe(400); // from/to 필수
      expect((await sysAgent.get('/api/v1/audit-logs?from=2020-01-01&to=2027-12-31')).body.code).toBe('RANGE_TOO_WIDE');
      expect((await sysAgent.get('/api/v1/audit-logs?from=2027-02-01&to=2027-01-01')).status).toBe(400); // to < from

      const today = new Date().toISOString().slice(0, 10);
      const since = await maxAudit();
      const list = (await sysAgent.get(`/api/v1/audit-logs?from=${today}&to=${today}&target_table=course&action=CREATE`).expect(200)).body;
      const found = list.items.find((r: { targetId: number }) => r.targetId === created.courseId);
      expect(found).toMatchObject({ action: 'CREATE', targetTable: 'course', actorType: 'USER', actorUserId: ops, actorName: 'e2e_ops', actorLoginId: 'e2e_ops' });
      const viewLogs = (await auditSince(since)).filter((r) => r.action === 'VIEW_SENSITIVE' && r.target_table === 'audit_log');
      expect(viewLogs).toHaveLength(1); // 목록 조회 자체가 감사 대상(1건)
      expect(Number(viewLogs[0].target_id)).toBe(Math.max(...list.items.map((r: { logId: number }) => r.logId)));
      expect(viewLogs[0].reason).toContain('조회:');

      const detailSince = await maxAudit();
      const detail = (await sysAgent.get(`/api/v1/audit-logs/${found.logId}`).expect(200)).body;
      expect(detail.afterValue).toMatchObject({ course_name: '감사조회용' });
      expect(detail.actorName).toBe('e2e_ops');
      const detailViews = (await auditSince(detailSince)).filter((r) => r.action === 'VIEW_SENSITIVE' && r.target_table === 'audit_log');
      expect(detailViews).toHaveLength(1);
      expect(Number(detailViews[0].target_id)).toBe(found.logId);
      expect((await sysAgent.get('/api/v1/audit-logs/999999999')).status).toBe(404);

      expect((await (await as('exec')).get(`/api/v1/audit-logs?from=${today}&to=${today}`)).status).toBe(200); // EXECUTIVE 도 조회 가능
      expect((await ops1.get(`/api/v1/audit-logs?from=${today}&to=${today}`)).status).toBe(403);
      expect((await (await as('ins1')).get(`/api/v1/audit-logs?from=${today}&to=${today}`)).status).toBe(403);
    });
  });

  // ── 사용자 관리 (S25) ───────────────────────────────────────────────────
  describe('사용자 관리 (S25)', () => {
    it('마지막 활성 시스템 관리자는 비활성화·역할 변경 불가(409 LAST_ADMIN), 다른 관리자가 있으면 가능', async () => {
      const sysAgent = await as('sys');
      const other = await makeUser('e2e_sys2', 'SYS_ADMIN');
      await sysAgent.patch(`/api/v1/users/${other}`).send({ status: 'INACTIVE' }).expect(200); // e2e_sys 가 남아 있음
      // e2e_sys 외 활성 시스템 관리자를 모두 비활성화(시드 admin 포함) → e2e_sys 가 마지막
      await client.query(
        `UPDATE user_account SET status = 'INACTIVE' WHERE user_id <> $1 AND user_id IN (SELECT ur.user_id FROM user_role ur JOIN role r ON r.role_id = ur.role_id WHERE r.role_code = 'SYS_ADMIN')`,
        [sys],
      );
      expect((await sysAgent.patch(`/api/v1/users/${sys}`).send({ status: 'INACTIVE' })).body.code).toBe('LAST_ADMIN');
      expect((await sysAgent.patch(`/api/v1/users/${sys}`).send({ role: 'OPS_MANAGER' })).body.code).toBe('LAST_ADMIN');
      await sysAgent.patch(`/api/v1/users/${sys}`).send({ name: '이름만 변경' }).expect(200); // 관리자 권한을 잃지 않는 수정은 허용
    });

    it('등록: 임시 비밀번호 1회 노출·must_change_password=true, INSTRUCTOR 는 linked_instructor_id 필수, 응답에 password_hash 없음', async () => {
      const sysAgent = await as('sys');
      const created = (await sysAgent.post('/api/v1/users').send({ login_id: 'e2e_new_ops', name: '신규담당자', role: 'OPS_MANAGER' }).expect(201)).body;
      expect(created).toMatchObject({ loginId: 'e2e_new_ops', name: '신규담당자', roleCode: 'OPS_MANAGER', status: 'ACTIVE', mustChangePassword: true });
      expect(typeof created.tempPassword).toBe('string');
      expect(created.tempPassword.length).toBeGreaterThan(8);
      expect(JSON.stringify(created)).not.toMatch(/password_hash|scrypt\$/);
      expect((await rows('SELECT must_change_password FROM user_account WHERE user_id = $1', [created.userId]))[0].must_change_password).toBe(true);

      expect((await sysAgent.post('/api/v1/users').send({ login_id: 'e2e_no_link', name: '강사', role: 'INSTRUCTOR' })).status).toBe(400); // linked_instructor_id 필수
      const freeInstructor = await one(`INSERT INTO instructor (name) VALUES ('강사3') RETURNING instructor_id id`);
      const insCreated = (await sysAgent.post('/api/v1/users').send({ login_id: 'e2e_new_ins', name: '신규강사', role: 'INSTRUCTOR', linked_instructor_id: freeInstructor }).expect(201)).body;
      expect(insCreated).toMatchObject({ roleCode: 'INSTRUCTOR', linkedInstructorId: freeInstructor });

      expect((await sysAgent.post('/api/v1/users').send({ login_id: 'e2e_new_ops', name: 'x', role: 'OPS_MANAGER' })).body.code).toBe('LOGIN_ID_EXISTS');
      expect((await sysAgent.post('/api/v1/users').send({ login_id: 'e2e_dup_link', name: 'x', role: 'INSTRUCTOR', linked_instructor_id: i1 })).body.code).toBe('INSTRUCTOR_ALREADY_LINKED');
    });

    it('조회: 목록·상세 필터링, password_hash 미노출, 수정은 필드별 변경 + 역할 전환 시 linked_instructor_id 정규화', async () => {
      const sysAgent = await as('sys');
      const list = (await sysAgent.get('/api/v1/users?role=INSTRUCTOR').expect(200)).body;
      expect(list.items.map((u: { userId: number }) => u.userId)).toEqual(expect.arrayContaining([insUser1, insUser2]));
      expect(JSON.stringify(list)).not.toMatch(/password_hash|scrypt\$/);
      const detail = (await sysAgent.get(`/api/v1/users/${ops}`).expect(200)).body;
      expect(detail).toMatchObject({ loginId: 'e2e_ops', roleCode: 'OPS_MANAGER' });
      expect((await sysAgent.get('/api/v1/users/999999999')).status).toBe(404);

      const created = (await sysAgent.post('/api/v1/users').send({ login_id: 'e2e_switch', name: '전환대상', role: 'EXECUTIVE' }).expect(201)).body;
      expect((await sysAgent.patch(`/api/v1/users/${created.userId}`).send({})).status).toBe(400); // 변경 필드 없음
      const patched = (await sysAgent.patch(`/api/v1/users/${created.userId}`).send({ status: 'INACTIVE', email: 'a@b.com' }).expect(200)).body;
      expect(patched).toMatchObject({ status: 'INACTIVE', email: 'a@b.com', roleCode: 'EXECUTIVE' });

      expect((await sysAgent.patch(`/api/v1/users/${created.userId}`).send({ role: 'INSTRUCTOR' })).status).toBe(400); // linked_instructor_id 없이 전환 불가
      const freeInstructor = await one(`INSERT INTO instructor (name) VALUES ('강사4') RETURNING instructor_id id`);
      const toInstructor = (await sysAgent.patch(`/api/v1/users/${created.userId}`).send({ role: 'INSTRUCTOR', linked_instructor_id: freeInstructor }).expect(200)).body;
      expect(toInstructor).toMatchObject({ roleCode: 'INSTRUCTOR', linkedInstructorId: freeInstructor });

      const backToOps = (await sysAgent.patch(`/api/v1/users/${created.userId}`).send({ role: 'OPS_MANAGER' }).expect(200)).body;
      expect(backToOps.linkedInstructorId).toBeNull(); // INSTRUCTOR 아니게 되면 정규화되어 비워짐
      expect((await sysAgent.patch(`/api/v1/users/${created.userId}`).send({ linked_instructor_id: freeInstructor })).status).toBe(400); // INSTRUCTOR 아니면 지정 불가
    });

    it('비밀번호 초기화·본인 변경: 값은 응답 1회만 노출, 감사로그에 원문이 남지 않고, 변경 후 새 비밀번호로 로그인 가능', async () => {
      const sysAgent = await as('sys');
      const created = (await sysAgent.post('/api/v1/users').send({ login_id: 'e2e_pw', name: '비밀번호테스트', role: 'EXECUTIVE' }).expect(201)).body;

      const login1 = await request.agent(app.getHttpServer()).post('/api/v1/auth/login').send({ loginId: 'e2e_pw', password: created.tempPassword }).expect(200);
      expect(login1.body.user.mustChangePassword).toBe(true);
      const ownAgent = request.agent(app.getHttpServer());
      await ownAgent.post('/api/v1/auth/login').send({ loginId: 'e2e_pw', password: created.tempPassword }).expect(200);

      expect((await ownAgent.post('/api/v1/auth/change-password').send({ currentPassword: 'wrong', newPassword: 'a-new-password-1' })).status).toBe(401);
      expect((await ownAgent.post('/api/v1/auth/change-password').send({ currentPassword: created.tempPassword, newPassword: 'short' })).status).toBe(400); // 최소 길이

      const since = await maxAudit();
      await ownAgent.post('/api/v1/auth/change-password').send({ currentPassword: created.tempPassword, newPassword: 'a-new-password-1' }).expect(200);
      const logs = (await auditSince(since)).filter((r) => r.target_table === 'user_account' && r.action === 'UPDATE');
      expect(logs).toHaveLength(1);
      expect(JSON.stringify(logs)).not.toContain('a-new-password-1');
      expect(JSON.stringify(logs)).not.toContain(created.tempPassword);

      const meAfter = (await ownAgent.get('/api/v1/auth/me').expect(200)).body;
      expect(meAfter.user.mustChangePassword).toBe(false);
      await request.agent(app.getHttpServer()).post('/api/v1/auth/login').send({ loginId: 'e2e_pw', password: created.tempPassword }).expect(401); // 옛 비밀번호 무효
      await request.agent(app.getHttpServer()).post('/api/v1/auth/login').send({ loginId: 'e2e_pw', password: 'a-new-password-1' }).expect(200);

      const resetSince = await maxAudit();
      const reset = (await sysAgent.post(`/api/v1/users/${created.userId}/reset-password`).expect(200)).body;
      expect(typeof reset.tempPassword).toBe('string');
      expect((await rows('SELECT must_change_password FROM user_account WHERE user_id = $1', [created.userId]))[0].must_change_password).toBe(true);
      expect(JSON.stringify(await auditSince(resetSince))).not.toContain(reset.tempPassword);
      await request.agent(app.getHttpServer()).post('/api/v1/auth/login').send({ loginId: 'e2e_pw', password: 'a-new-password-1' }).expect(401);
      await request.agent(app.getHttpServer()).post('/api/v1/auth/login').send({ loginId: 'e2e_pw', password: reset.tempPassword }).expect(200);
    });

    it('SYS_ADMIN 외 역할은 사용자 관리 전부 403, 비밀번호 변경은 로그인만 하면 누구나 가능', async () => {
      for (const who of ['ops', 'exec', 'ins1'] as const) {
        const agent = await as(who);
        expect((await agent.get('/api/v1/users')).status, who).toBe(403);
        expect((await agent.post('/api/v1/users').send({})).status, who).toBe(403);
      }
      const ins = await as('ins1');
      expect((await ins.post('/api/v1/auth/change-password').send({ currentPassword: 'wrong', newPassword: 'irrelevant1' })).status).toBe(401); // 권한 문제가 아니라 비밀번호 불일치
    });
  });

  // ── 통합 시나리오: 과정 생성 → … → CLOSED ────────────────────────────────
  // 개별 기능은 위 describe 블록들이 이미 상세히 검증하므로, 여기서는 전체 흐름의 ID/FK/권한/상태전이 연결만 확인한다.
  describe('통합 시나리오 (전체 업무 흐름 E2E)', () => {
    it('과정 생성부터 CLOSED까지 하나의 흐름으로 연결된다(감사로그·대시보드 반영 포함)', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      const flowInstructorId = (await ops1.post('/api/v1/instructors').send({ name: '흐름강사' }).expect(201)).body.instructorId;
      const flowInsLoginId = 'e2e_flowins';
      await makeUser(flowInsLoginId, 'INSTRUCTOR', flowInstructorId);
      const flowIns = request.agent(app.getHttpServer());
      await flowIns.post('/api/v1/auth/login').send({ loginId: flowInsLoginId, password: PASSWORD }).expect(200);

      // 1) 과정 생성 → 모집 시작
      const course = (await ops1.post('/api/v1/courses').send({ course_name: '통합흐름과정', start_date: '2020-01-01', end_date: '2020-01-31', total_hours: 10, training_site: '본원', manager_user_id: ops }).expect(201)).body;
      await ops1.post(`/api/v1/courses/${course.courseId}/open-recruitment`).expect(200);

      // 2) 강사 배정 → 교육일정 생성(과거 날짜 — 종료된 회차 기준 항목들을 실제로 검증하기 위함)
      await ops1.post(`/api/v1/courses/${course.courseId}/instructor-assignments`).send({ instructor_id: flowInstructorId }).expect(201);
      const schedule = (
        await ops1.post(`/api/v1/courses/${course.courseId}/schedules`).send({ round_no: 1, class_date: '2020-01-02', start_time: '09:00', end_time: '18:00', instructor_id: flowInstructorId, content: '이론' }).expect(201)
      ).body;

      // 3) 훈련생 등록 → 확정
      const enrolled = (await ops1.post('/api/v1/enrollments').send({ course_id: course.courseId, trainee: { name: '흐름훈련생', birth_date: '1996-05-05', contact: '010-1111-2222' } }).expect(201)).body;
      const traineeId = enrolled.trainee.traineeId;
      const enrollmentId = enrolled.enrollment.enrollmentId;
      await ops1.post(`/api/v1/enrollments/${enrollmentId}/start-review`).expect(200);
      await ops1.post(`/api/v1/enrollments/${enrollmentId}/confirm`).send({ reason: '서류 확인 완료' }).expect(200);

      // 4) 확정 훈련생이 있으므로 경고 없이 운영중 전환
      expect((await ops1.post(`/api/v1/courses/${course.courseId}/start`).send({})).body.status).toBe('IN_PROGRESS');

      // 5) 출결 입력(입실+퇴실)
      const checkedIn = (await ops1.post(`/api/v1/schedules/${schedule.scheduleId}/attendance/check-in`).send({ trainee_ids: [traineeId] }).expect(201)).body;
      const attendanceId = checkedIn.created[0].attendanceId;
      await ops1.post('/api/v1/attendance/check-out').send({ attendance_ids: [attendanceId] }).expect(200);

      // 6) 운영일지 작성(강사)
      await flowIns.post(`/api/v1/schedules/${schedule.scheduleId}/operation-log`).send({ content: '정상 진행', participant_count: 1 }).expect(201);

      // 7) 특이사항 등록 → 결과물 등록·검토 → 특이사항을 확인 필요로 전환
      const issue = (await ops1.post('/api/v1/course-issues').send({ course_id: course.courseId, category: 'OTHER', content: '경미한 지연' }).expect(201)).body;
      const submission = (await ops1.post(`/api/v1/courses/${course.courseId}/submissions`).send({ trainee_id: traineeId, title: '수료 보고서', submitted_at: '2020-01-03T00:00:00Z' }).expect(201)).body;
      await ops1.post(`/api/v1/submissions/${submission.submissionId}/reviews`).send({ review_result: 'APPROVED' }).expect(201);
      const escalated = (await ops1.post(`/api/v1/course-issues/${issue.issueId}/escalate`).send({ trainee_ids: [traineeId] }).expect(201)).body;
      expect(escalated).toMatchObject({ courseId: course.courseId, status: 'NEEDS_CHECK' });

      // 8) 확인 필요 목록에서 조회 → 확인 시작 → 확인완료(종결)
      const caseList = (await ops1.get(`/api/v1/verification-cases?course_id=${course.courseId}`).expect(200)).body;
      expect(caseList.items).toEqual([expect.objectContaining({ caseId: escalated.caseId, courseId: course.courseId })]);
      await ops1.post(`/api/v1/verification-cases/${escalated.caseId}/start-review`).send({ confirmation_note: '경미한 사안 확인' }).expect(200);
      const closedCase = (await ops1.post(`/api/v1/verification-cases/${escalated.caseId}/complete-confirmation`).send({}).expect(200)).body;
      expect(closedCase.status).toBe('CONFIRMED');

      // 9) 완료 후보 조회: 100% 출석이므로 후보 없음(80% 미달자만 후보)
      const candidates = (await ops1.get(`/api/v1/courses/${course.courseId}/completion-candidates`).expect(200)).body;
      expect(candidates).toMatchObject({ ready: true, items: [] });

      // 10) 종료 체크리스트: 확인 건도 종결됐고 전부 처리됐으므로 남은 경고는 "확정 상태로 남은 등록 건"(#7)뿐
      const checklist = (await ops1.get(`/api/v1/courses/${course.courseId}/closure-checklist`).expect(200)).body;
      const byItem = new Map(checklist.items.map((i: { item: number; count: number }) => [i.item, i.count]));
      expect(byItem.get(1)).toBe(0); // 미출결 없음
      expect(byItem.get(2)).toBe(0); // 퇴실 미확인 없음
      expect(byItem.get(3)).toBe(0); // 확인 건이 종결됨
      expect(byItem.get(4)).toBe(0); // 운영일지 작성됨
      expect(byItem.get(5)).toBe(0); // 결과물 제출됨
      expect(byItem.get(6)).toBe(0); // 검토 완료됨(APPROVED)
      expect(byItem.get(7)).toBe(1); // 확정 상태 그대로(수료 처리 전)

      // 11) 종료: 경고(#7) 있으므로 사유 없이는 400, 사유와 함께 CLOSED
      expect((await ops1.post(`/api/v1/courses/${course.courseId}/close`).send({})).status).toBe(400);
      const closed = (await ops1.post(`/api/v1/courses/${course.courseId}/close`).send({ override_reason: '수료 처리는 별도 진행' }).expect(200)).body;
      expect(closed.status).toBe('CLOSED');
      expect((await ops1.patch(`/api/v1/courses/${course.courseId}`).send({ training_site: 'x' })).body.code).toBe('COURSE_LOCKED'); // V7: 종료 후 잠금

      // 12) 감사로그: 흐름의 각 CREATE/UPDATE 이벤트가 실제로 기록됐는지 확인
      const flowLogs = await auditSince(since);
      const targets = flowLogs.map((r) => `${r.action}:${r.target_table}`);
      for (const expected of [
        'CREATE:course', 'CREATE:instructor', 'CREATE:instructor_assignment', 'CREATE:class_schedule',
        'CREATE:trainee', 'CREATE:trainee_enrollment', 'CREATE:attendance', 'CREATE:operation_log',
        'CREATE:course_issue', 'CREATE:submission', 'CREATE:submission_review_log', 'CREATE:verification_case',
        'UPDATE:course_issue', 'UPDATE:verification_case', 'UPDATE:course',
      ]) {
        expect(targets, expected).toContain(expected);
      }

      // 13) 대시보드: CLOSED 과정은 더 이상 집계에 포함되지 않는다
      const dashboardAfterClose = (await ops1.get(`/api/v1/dashboard?course_id=${course.courseId}`).expect(200)).body;
      expect(dashboardAfterClose.counts).toEqual({ notCheckedIn: 0, checkoutMissing: 0, operationLogMissing: 0, submissionMissing: 0, reviewPending: 0 });
      expect(dashboardAfterClose.verificationSummary).toEqual({ byStatus: [], recent: [] });
    });
  });

  // ── 트랜잭션 원자성: 장애 주입 ──────────────────────────────────────────
  // 감사로그·변경이력·원본 중 하나라도 실패하면 API 는 500 이고 나머지도 전부 되돌려진다.
  describe('트랜잭션 원자성 (장애 주입)', () => {
    const failing = async (pattern: RegExp, call: () => Promise<{ status: number; body: { message?: string } }>) => {
      pool.failOn = pattern;
      const res = await call();
      pool.failOn = null;
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('injected'); // 내부 오류 메시지 비노출
    };

    it('과정 상태 전이: 감사로그 실패 → 상태 유지·감사 기록 없음', async () => {
      const created = (await (await as('ops')).post('/api/v1/courses').send({ course_name: 'A', start_date: '2027-05-01', end_date: '2027-06-01', total_hours: 10, training_site: 'x', manager_user_id: ops }).expect(201)).body.courseId;
      const since = await maxAudit();
      const ops1 = await as('ops');
      await failing(/INSERT INTO audit_log/, () => ops1.post(`/api/v1/courses/${created}/open-recruitment`));
      expect((await rows('SELECT status FROM course WHERE course_id = $1', [created]))[0].status).toBe('PREPARING');
      expect((await auditSince(since)).filter((r) => r.target_table === 'course')).toHaveLength(0);
      await ops1.post(`/api/v1/courses/${created}/open-recruitment`).expect(200); // 장애 해제 후 정상 처리
    });

    it('과정 등록·수정: 감사로그/UPDATE 실패 → 행 미생성·미변경', async () => {
      const ops1 = await as('ops');
      const before = await num('SELECT count(*) n FROM course');
      await failing(/INSERT INTO audit_log/, () => ops1.post('/api/v1/courses').send({ course_name: '유령', start_date: '2027-05-01', end_date: '2027-06-01', total_hours: 10, training_site: 'x', manager_user_id: ops }));
      expect(await num('SELECT count(*) n FROM course')).toBe(before);
      await failing(/UPDATE "course"/, () => ops1.patch(`/api/v1/courses/${c1}`).send({ training_site: '변경' }));
      expect((await rows('SELECT training_site FROM course WHERE course_id = $1', [c1]))[0].training_site).toBe('본원');
    });

    it('등록 건 확정: 변경이력 실패 / 감사로그 실패 어느 쪽이어도 원본·이력·감사가 모두 그대로', async () => {
      const ops1 = await as('ops');
      await client.query(`UPDATE trainee_enrollment SET status = 'REVIEWING' WHERE trainee_id = $1 AND course_id = $2`, [tApplied1, c1]);
      const enrollmentId = await one(`SELECT enrollment_id id FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2`, [tApplied1, c1]);
      const since = await maxAudit();
      const logs = () => num(`SELECT count(*) n FROM trainee_change_log WHERE entity_type = 'ENROLLMENT' AND entity_id = $1`, [enrollmentId]);
      for (const pattern of [/INSERT INTO trainee_change_log/, /INSERT INTO audit_log/]) {
        await failing(pattern, () => ops1.post(`/api/v1/enrollments/${enrollmentId}/confirm`));
        const row = (await rows('SELECT status, confirmed_at, confirmed_by FROM trainee_enrollment WHERE enrollment_id = $1', [enrollmentId]))[0];
        expect(row).toEqual({ status: 'REVIEWING', confirmed_at: null, confirmed_by: null });
        expect(await logs()).toBe(0);
        expect((await auditSince(since)).filter((r) => r.action === 'UPDATE')).toHaveLength(0);
      }
      await ops1.post(`/api/v1/enrollments/${enrollmentId}/confirm`).expect(200);
      expect(await logs()).toBe(1);
    });

    it('신규 등록(인물 + 등록 건): 등록 건 생성 실패 → 인물도 남지 않는다', async () => {
      const ops1 = await as('ops');
      const trainees = await num('SELECT count(*) n FROM trainee');
      const since = await maxAudit();
      await failing(/INSERT INTO "trainee_enrollment"/, () => ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee: { name: '고아', contact: '010-1212-3434' } }));
      expect(await num('SELECT count(*) n FROM trainee')).toBe(trainees);
      expect((await auditSince(since)).filter((r) => r.action === 'CREATE')).toHaveLength(0);
      // 감사 실패도 동일
      await failing(/INSERT INTO audit_log/, () => ops1.post('/api/v1/enrollments').send({ course_id: c1, trainee: { name: '고아2' } }));
      expect(await num('SELECT count(*) n FROM trainee')).toBe(trainees);
      expect(await num(`SELECT count(*) n FROM trainee_enrollment te JOIN trainee t ON t.trainee_id = te.trainee_id WHERE t.name LIKE '고아%'`)).toBe(0);
    });

    it('훈련생·강사 인적정보 수정: 변경이력/감사 실패 → 원본 미변경', async () => {
      const ops1 = await as('ops');
      const logs = () => num(`SELECT count(*) n FROM trainee_change_log`);
      const logsBefore = await logs();
      await failing(/INSERT INTO trainee_change_log/, () => ops1.patch(`/api/v1/trainees/${tConfirmed1}`).send({ name: '변경', reason: 'r' }));
      expect((await rows('SELECT name FROM trainee WHERE trainee_id = $1', [tConfirmed1]))[0].name).toBe('확정1');
      await failing(/INSERT INTO audit_log/, () => ops1.patch(`/api/v1/instructors/${i1}`).send({ name: '변경', reason: 'r' }));
      expect((await rows('SELECT name FROM instructor WHERE instructor_id = $1', [i1]))[0].name).toBe('강사1');
      expect(await logs()).toBe(logsBefore);
      expect(await num(`SELECT count(*) n FROM instructor_change_log WHERE entity_id = $1`, [i1])).toBe(0);
    });

    it('회차 등록·휴강·수정: 감사 실패 → 행 미생성·상태 유지', async () => {
      const ops1 = await as('ops');
      const count = () => num('SELECT count(*) n FROM class_schedule');
      const before = await count();
      await failing(/INSERT INTO audit_log/, () => ops1.post(`/api/v1/courses/${c1}/schedules`).send({ round_no: 9, class_date: '2027-02-01', start_time: '09:00', end_time: '10:00', instructor_id: i1 }));
      expect(await count()).toBe(before);
      await failing(/INSERT INTO audit_log/, () => ops1.post(`/api/v1/schedules/${s1}/cancel-class`).send({ reason: '휴강' }));
      expect((await rows('SELECT status FROM class_schedule WHERE schedule_id = $1', [s1]))[0].status).toBe('SCHEDULED');
      await failing(/UPDATE "class_schedule"/, () => ops1.patch(`/api/v1/schedules/${s1}`).send({ content: '변경' }));
      expect((await rows('SELECT content FROM class_schedule WHERE schedule_id = $1', [s1]))[0].content).toBeNull();
    });

    it('강사 배정·취소: 변경이력/감사 실패 → 배정 상태 유지·이력 없음', async () => {
      const ops1 = await as('ops');
      const assignments = await num('SELECT count(*) n FROM instructor_assignment');
      await failing(/INSERT INTO audit_log/, () => ops1.post(`/api/v1/courses/${c2}/instructor-assignments`).send({ instructor_id: i1, round_no: 1 }));
      expect(await num('SELECT count(*) n FROM instructor_assignment')).toBe(assignments);
      const assignmentId = await one(`SELECT assignment_id id FROM instructor_assignment WHERE course_id = $1`, [c1]);
      await failing(/INSERT INTO instructor_change_log/, () => ops1.post(`/api/v1/instructor-assignments/${assignmentId}/cancel`).send({ reason: 'r' }));
      expect((await rows('SELECT status FROM instructor_assignment WHERE assignment_id = $1', [assignmentId]))[0].status).toBe('ASSIGNED');
      expect(await num(`SELECT count(*) n FROM instructor_change_log WHERE entity_type = 'ASSIGNMENT'`)).toBe(0);
      expect((await (await as('ins1')).get(`/api/v1/courses/${c1}`)).status).toBe(200); // 스코프도 그대로
    });

    it('DB 제약 위반(409)도 부분 기록을 남기지 않는다: 중복 회차', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      const res = await ops1.post(`/api/v1/courses/${c1}/schedules`).send({ round_no: 1, class_date: '2027-02-01', start_time: '09:00', end_time: '10:00', instructor_id: i1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ROUND_EXISTS');
      expect((await auditSince(since)).filter((r) => r.target_table === 'class_schedule')).toHaveLength(0);
    });

    it('권한 저장: 감사 실패 → 삭제·재삽입 전체가 롤백되어 이전 매트릭스가 그대로 남는다', async () => {
      const sysAgent = await as('sys');
      const instructorRoleId = await one(`SELECT role_id id FROM role WHERE role_code = 'INSTRUCTOR'`);
      const before = (await sysAgent.get(`/api/v1/roles/permissions?role_id=${instructorRoleId}`).expect(200)).body;
      const countBefore = await num(`SELECT count(*) n FROM role_permission WHERE role_id = $1`, [instructorRoleId]);
      await failing(/INSERT INTO audit_log/, () =>
        sysAgent.put(`/api/v1/roles/${instructorRoleId}/permissions`).send({ items: before.items.filter((i: { screenId: string }) => i.screenId !== 'S05') }),
      );
      expect(await num(`SELECT count(*) n FROM role_permission WHERE role_id = $1`, [instructorRoleId])).toBe(countBefore);
      expect(await num(`SELECT count(*) n FROM role_permission WHERE role_id = $1 AND screen_id = 'S05'`, [instructorRoleId])).toBe(1);
    });

    it('사용자 등록: user_role 생성 실패 → user_account 도 함께 롤백된다(2단계 원자성)', async () => {
      const sysAgent = await as('sys');
      const before = await num(`SELECT count(*) n FROM user_account`);
      await failing(/INSERT INTO "user_role"/, () => sysAgent.post('/api/v1/users').send({ login_id: 'e2e_atomic', name: 'x', role: 'OPS_MANAGER' }));
      expect(await num(`SELECT count(*) n FROM user_account`)).toBe(before);
      expect(await num(`SELECT count(*) n FROM user_account WHERE login_id = 'e2e_atomic'`)).toBe(0);
    });

    it('입실 확인: 감사 실패 → attendance 행이 남지 않는다', async () => {
      const ops1 = await as('ops');
      await failing(/INSERT INTO audit_log/, () => ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }));
      expect(await num(`SELECT count(*) n FROM attendance`)).toBe(0);
    });

    it('출결 정정: attendance_change_log 실패 / audit_log 실패 어느 쪽이어도 원본·이력·감사가 모두 그대로', async () => {
      const ops1 = await as('ops');
      const attendanceId = (await ops1.post(`/api/v1/schedules/${s1}/attendance/check-in`).send({ trainee_ids: [tConfirmed1] }).expect(201)).body.created[0].attendanceId;
      const since = await maxAudit();
      for (const pattern of [/INSERT INTO attendance_change_log/, /INSERT INTO audit_log/]) {
        await failing(pattern, () => ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'LATE', reason: 'r', expected_last_modified_at: null }));
        const row = (await rows('SELECT attendance_status, last_modified_at FROM attendance WHERE attendance_id = $1', [attendanceId]))[0];
        expect(row).toEqual({ attendance_status: 'PRESENT', last_modified_at: null });
        expect(await num(`SELECT count(*) n FROM attendance_change_log WHERE attendance_id = $1`, [attendanceId])).toBe(0);
        expect((await auditSince(since)).filter((r) => r.target_table === 'attendance' && r.action === 'UPDATE')).toHaveLength(0);
      }
      await ops1.post(`/api/v1/attendance/${attendanceId}/correct`).send({ attendance_status: 'LATE', reason: 'r', expected_last_modified_at: null }).expect(200);
      expect(await num(`SELECT count(*) n FROM attendance_change_log WHERE attendance_id = $1`, [attendanceId])).toBe(1);
    });

    it('운영일지 작성·수정: 감사 실패 → 행 미생성·미변경', async () => {
      const ins1 = await as('ins1');
      await failing(/INSERT INTO audit_log/, () => ins1.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: 'x', participant_count: 1 }));
      expect(await num(`SELECT count(*) n FROM operation_log WHERE schedule_id = $1`, [s1])).toBe(0);

      const created = (await ins1.post(`/api/v1/schedules/${s1}/operation-log`).send({ content: '원본', participant_count: 1 }).expect(201)).body;
      await failing(/INSERT INTO audit_log/, () => ins1.patch(`/api/v1/operation-logs/${created.operationLogId}`).send({ content: '변경' }));
      expect((await rows('SELECT content FROM operation_log WHERE operation_log_id = $1', [created.operationLogId]))[0].content).toBe('원본');
    });

    it('특이사항 등록·수정: 감사 실패 → 행 미생성·미변경', async () => {
      const ops1 = await as('ops');
      const before = await num('SELECT count(*) n FROM course_issue');
      await failing(/INSERT INTO audit_log/, () => ops1.post('/api/v1/course-issues').send({ course_id: c1, category: 'OTHER', content: 'x' }));
      expect(await num('SELECT count(*) n FROM course_issue')).toBe(before);

      const created = (await ops1.post('/api/v1/course-issues').send({ course_id: c1, category: 'OTHER', content: '원본' }).expect(201)).body;
      await failing(/INSERT INTO audit_log/, () => ops1.patch(`/api/v1/course-issues/${created.issueId}`).send({ content: '변경' }));
      expect((await rows('SELECT content, status FROM course_issue WHERE issue_id = $1', [created.issueId]))[0]).toEqual({ content: '원본', status: 'REGISTERED' });
    });

    it('확인 필요 상태 전이: action_log 실패 / audit_log 실패 어느 쪽이어도 상태·이력·감사가 모두 그대로', async () => {
      const manual = await one(`SELECT rule_id id FROM detection_rule WHERE rule_code = 'MANUAL'`);
      const caseId = await one(
        `INSERT INTO verification_case (course_id, detection_rule_id, detected_at, evidence, status) VALUES ($1, $2, now(), '{"dedupe_key":"t","items":[{"id":"t"}]}', 'NEEDS_CHECK') RETURNING case_id id`,
        [c1, manual],
      );
      const ops1 = await as('ops');
      const since = await maxAudit();
      for (const pattern of [/INSERT INTO verification_action_log/, /INSERT INTO audit_log/]) {
        await failing(pattern, () => ops1.post(`/api/v1/verification-cases/${caseId}/start-review`).send({ confirmation_note: 'x' }));
        expect((await rows('SELECT status, confirmation_note FROM verification_case WHERE case_id = $1', [caseId]))[0]).toEqual({ status: 'NEEDS_CHECK', confirmation_note: null });
        expect(await num(`SELECT count(*) n FROM verification_action_log WHERE case_id = $1`, [caseId])).toBe(0);
        expect((await auditSince(since)).filter((r) => r.target_table === 'verification_case' && r.action === 'UPDATE')).toHaveLength(0);
      }
      await ops1.post(`/api/v1/verification-cases/${caseId}/start-review`).send({ confirmation_note: 'x' }).expect(200);
      expect(await num(`SELECT count(*) n FROM verification_action_log WHERE case_id = $1`, [caseId])).toBe(1);
    });

    it('확인 필요로 전환(escalate): verification_case 실패 → issue.status 미변경, 사건도 생성되지 않음', async () => {
      const ops1 = await as('ops');
      const issue = (await ops1.post('/api/v1/course-issues').send({ course_id: c1, category: 'OTHER', content: 'x' }).expect(201)).body;
      await failing(/INSERT INTO "verification_case"/, () => ops1.post(`/api/v1/course-issues/${issue.issueId}/escalate`).send({}));
      expect((await rows('SELECT status FROM course_issue WHERE issue_id = $1', [issue.issueId]))[0].status).toBe('REGISTERED');
      expect(await num(`SELECT count(*) n FROM verification_case WHERE related_course_issue_id = $1`, [issue.issueId])).toBe(0);
    });

    it('결과물 검토: submission_review_log 실패 / audit_log 실패 어느 쪽이어도 review_status·이력·감사가 모두 그대로', async () => {
      const ops1 = await as('ops');
      const created = (await ops1.post(`/api/v1/courses/${c1}/submissions`).send({ trainee_id: tConfirmed1, title: 'x', submitted_at: '2027-01-10T00:00:00Z' }).expect(201)).body;
      const since = await maxAudit();
      for (const pattern of [/INSERT INTO "submission_review_log"/, /UPDATE "submission"/]) {
        await failing(pattern, () => ops1.post(`/api/v1/submissions/${created.submissionId}/reviews`).send({ review_result: 'APPROVED' }));
        expect((await rows('SELECT review_status FROM submission WHERE submission_id = $1', [created.submissionId]))[0].review_status).toBe('PENDING');
        expect(await num(`SELECT count(*) n FROM submission_review_log WHERE submission_id = $1`, [created.submissionId])).toBe(0);
        expect((await auditSince(since)).filter((r) => r.target_table === 'submission')).toHaveLength(0);
      }
      await ops1.post(`/api/v1/submissions/${created.submissionId}/reviews`).send({ review_result: 'APPROVED' }).expect(201);
      expect(await num(`SELECT count(*) n FROM submission_review_log WHERE submission_id = $1`, [created.submissionId])).toBe(1);
    });

    it('과정 종료: 스냅샷 감사로그 실패 → 상태·감사 모두 그대로(course UPDATE 도 함께 롤백)', async () => {
      const ops1 = await as('ops');
      const since = await maxAudit();
      await failing(/INSERT INTO audit_log \(actor_type, actor_user_id, action, target_table, target_id, after_value, reason, ip_address\)/, () =>
        ops1.post(`/api/v1/courses/${c1}/close`).send({ override_reason: 'x' }),
      );
      expect((await rows('SELECT status FROM course WHERE course_id = $1', [c1]))[0].status).toBe('IN_PROGRESS');
      expect((await auditSince(since)).filter((r) => r.target_table === 'course')).toHaveLength(0);
      await ops1.post(`/api/v1/courses/${c1}/close`).send({ override_reason: 'x' }).expect(200);
    });
  });
});
