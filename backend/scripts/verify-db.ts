// 실제 DB 검증(읽기 + 롤백되는 트랜잭션). 카탈로그가 baseline 과 일치하는지, 제약·트리거·시드가 실제로 동작하는지 확인한다.
// 데이터 변경 테스트는 모두 BEGIN … ROLLBACK 안에서 실행되어 DB 에 남지 않는다.
import 'dotenv/config';
import pg from 'pg';
import { PHASE1_PERMISSIONS } from '../seed/permissions.js';
import { ROLES } from '../seed/roles.js';

const results: { ok: boolean; name: string; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string): void => {
  results.push({ ok, name, detail });
};
const sameSet = (a: string[], b: string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = async <T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> => (await client.query<T>(sql, params)).rows;

const auditAtStart = Number((await q('SELECT count(*)::int n FROM audit_log'))[0].n); // 실행 중 롤백 누수 확인용(로그인 등 정상 이벤트로 늘어난 건수는 허용)

// ── 1. 카탈로그 ────────────────────────────────────────────────────────────
const TABLES = [
  'user_account', 'role', 'user_role', 'role_permission', 'audit_log', 'course', 'trainee', 'trainee_enrollment',
  'trainee_change_log', 'instructor', 'instructor_assignment', 'instructor_change_log', 'class_schedule',
  'attendance', 'attendance_change_log', 'operation_log', 'course_issue',
  'detection_rule', 'verification_case', 'verification_case_trainee', 'verification_action_log',
  'submission', 'submission_review_log', 'attachment', 'attendance_setting', 'attendance_source_raw',
];
const tables = (await q<{ relname: string }>(`SELECT relname FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname <> 'pgmigrations'`)).map((r) => r.relname);
check('테이블 26개', sameSet(tables, TABLES), tables.join(','));

const fkCount = Number((await q(`SELECT count(*)::int n FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`))[0].n);
check('FK 65개 (정적 검증과 동일)', fkCount === 65, `실제 ${fkCount}`);

const cons = await q<{ conname: string; contype: string }>(`SELECT conname, contype FROM pg_constraint WHERE connamespace = 'public'::regnamespace`);
const names = (type: string): string[] => cons.filter((c) => c.contype === type).map((c) => c.conname);
const UNIQUES = ['uq_user_account_login_id', 'uq_role_role_code', 'uq_user_account_linked_instructor', 'uq_class_schedule_course_round', 'uq_attendance_trainee_schedule', 'uq_operation_log_schedule', 'uq_submission_trainee_course_title'];
check('UNIQUE 제약 7개', UNIQUES.every((n) => names('u').includes(n)), UNIQUES.filter((n) => !names('u').includes(n)).join(','));
// P1-01·P1-02: 등록·배정의 전체 UNIQUE 제약은 제거되고 유효 건 기준 부분 유니크 인덱스로 대체되었다
check('P1-01·P1-02 전체 UNIQUE 제약 제거', !names('u').includes('uq_trainee_enrollment_trainee_course') && !names('u').includes('uq_instructor_assignment_key'));
const CHECKS = [
  'ck_role_permission_screen_id', 'ck_audit_log_actor_system_null', 'ck_audit_log_actor_user_required', 'ck_audit_log_target_id_required', 'ck_course_dates', 'ck_course_total_hours',
  'ck_attendance_change_log_actor_user_required', 'ck_attendance_change_log_actor_system_null', 'ck_attachment_entity_version_submission_only',
];
check('CHECK 제약 9개', CHECKS.every((n) => names('c').includes(n)), CHECKS.filter((n) => !names('c').includes(n)).join(','));

const indexes = await q<{ indexname: string; indexdef: string }>(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`);
const IDX = [
  'idx_audit_log_action_at', 'idx_audit_log_actor_user_action_at', 'idx_audit_log_target', 'idx_course_status', 'idx_course_period',
  'idx_instructor_status', 'idx_instructor_assignment_course_status', 'idx_instructor_change_log_entity', 'idx_trainee_name_birth',
  'idx_trainee_enrollment_course_status', 'idx_trainee_change_log_entity', 'idx_class_schedule_class_date', 'idx_class_schedule_instructor_date',
  'idx_attendance_schedule', 'idx_attendance_trainee', 'idx_attendance_change_log_attendance', 'idx_attendance_change_log_trainee',
  'idx_operation_log_instructor', 'idx_course_issue_course_status',
  'idx_verification_case_status_detected', 'idx_verification_case_course_status', 'idx_verification_case_assignee_status', 'idx_verification_case_rule_status',
  'idx_verification_case_trainee_trainee', 'idx_verification_action_log_case',
  'idx_submission_course_review', 'idx_submission_review_log_submission', 'idx_attachment_entity',
];
check('INDEX 28개', IDX.every((n) => indexes.some((i) => i.indexname === n)), IDX.filter((n) => !indexes.some((i) => i.indexname === n)).join(','));
const partial = indexes.find((i) => i.indexname === 'uq_instructor_assignment_course_wide');
check('부분 유니크 인덱스(과정 전체 담당)', !!partial && /UNIQUE/.test(partial.indexdef) && /WHERE/.test(partial.indexdef), partial?.indexdef);
const activeEnrollment = indexes.find((i) => i.indexname === 'uq_trainee_enrollment_active');
check('부분 유니크 인덱스(유효 등록 건, CANCELLED 제외)', !!activeEnrollment && /UNIQUE/.test(activeEnrollment.indexdef) && /CANCELLED/.test(activeEnrollment.indexdef), activeEnrollment?.indexdef);
const activeAssignment = indexes.find((i) => i.indexname === 'uq_instructor_assignment_active');
check('부분 유니크 인덱스(유효 배정, ASSIGNED 기준)', !!activeAssignment && /UNIQUE/.test(activeAssignment.indexdef) && /ASSIGNED/.test(activeAssignment.indexdef), activeAssignment?.indexdef);

const enums = await q<{ typname: string; vals: string[] }>(
  `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) vals FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`,
);
const EXPECTED_ENUMS: Record<string, string[]> = {
  course_status: ['PREPARING', 'RECRUITING', 'IN_PROGRESS', 'CLOSED', 'SUSPENDED'],
  enrollment_status: ['APPLIED', 'REVIEWING', 'CONFIRMED', 'COMPLETED', 'DROPPED', 'EXPELLED', 'CANCELLED'],
  schedule_status: ['SCHEDULED', 'CANCELLED'],
  instructor_status: ['ACTIVE', 'INACTIVE'],
  assignment_status: ['ASSIGNED', 'CANCELLED'],
  user_status: ['ACTIVE', 'INACTIVE'],
  role_code: ['SYS_ADMIN', 'OPS_MANAGER', 'INSTRUCTOR', 'EXECUTIVE'],
  permission_action: ['C', 'R', 'U', 'D', 'A'],
  permission_scope: ['ALL', 'OWN_ASSIGNED'],
  audit_actor_type: ['USER', 'SYSTEM_RULE', 'SYSTEM_BATCH', 'SYSTEM_API'],
  audit_action: ['CREATE', 'UPDATE', 'DELETE', 'VIEW_SENSITIVE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'ACCESS_DENIED'],
  trainee_change_entity: ['TRAINEE', 'ENROLLMENT'],
  instructor_change_entity: ['INSTRUCTOR', 'ASSIGNMENT'],
  attendance_status: ['PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED'],
  attendance_source_type: ['OFFICIAL', 'MANUAL', 'LINKED'],
  attendance_change_actor_type: ['USER', 'SYSTEM_BATCH', 'SYSTEM_API'],
  course_issue_category: ['FACILITY', 'COMPLAINT', 'SAFETY', 'OTHER'],
  course_issue_status: ['REGISTERED', 'IN_REVIEW', 'RESOLVED'],
  verification_case_status: ['NEEDS_CHECK', 'PRIORITY_CHECK', 'IN_REVIEW', 'CONFIRMED', 'ACTION_REQUIRED', 'ACTION_DONE', 'FOLLOW_UP'],
  verification_action_type: ['CHECK', 'ACTION_ENTRY', 'CLOSE', 'REOPEN', 'STATUS_CHANGE'],
  submission_submit_status: ['SUBMITTED', 'LATE_SUBMITTED'],
  submission_review_status: ['PENDING', 'APPROVED', 'REVISION_REQUESTED', 'REJECTED'],
  submission_review_result: ['APPROVED', 'REVISION_REQUESTED', 'REJECTED'],
  attachment_entity_type: ['OPERATION_LOG', 'SUBMISSION', 'COURSE_ISSUE'],
};
const enumBad = Object.entries(EXPECTED_ENUMS).filter(([n, v]) => JSON.stringify(enums.find((e) => e.typname === n)?.vals) !== JSON.stringify(v)).map(([n]) => n);
check('enum 24개 값·순서 (baseline 3절)', enumBad.length === 0, enumBad.join(','));

const trig = await q<{ tbl: string; fn: string; tgtype: number }>(
  `SELECT c.relname tbl, p.proname fn, t.tgtype FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid WHERE NOT t.tgisinternal`,
);
const APPEND_ONLY = [
  'audit_log', 'trainee_change_log', 'instructor_change_log', 'attendance_change_log',
  'verification_case_trainee', 'verification_action_log', 'submission_review_log', 'attachment',
];
const UPDATED_AT = ['user_account', 'role', 'role_permission', 'course', 'trainee', 'trainee_enrollment', 'instructor', 'instructor_assignment', 'class_schedule'];
check('append-only 트리거 (행 단위 UPDATE/DELETE + TRUNCATE) 9개 테이블', APPEND_ONLY.every((t) => trig.filter((x) => x.tbl === t && x.fn === 'forbid_modification').length === 2));
check('updated_at 트리거 9개 테이블', UPDATED_AT.every((t) => trig.some((x) => x.tbl === t && x.fn === 'set_updated_at')));

// ── 2. 시드 ────────────────────────────────────────────────────────────────
const roles = (await q<{ role_code: string }>('SELECT role_code FROM role')).map((r) => r.role_code);
check('role 4개', sameSet(roles, ROLES.map((r) => r.roleCode)), roles.join(','));
const perms = (await q<{ role_code: string; screen_id: string; action: string; scope_type: string }>(
  `SELECT r.role_code, rp.screen_id, rp.action, rp.scope_type FROM role_permission rp JOIN role r USING (role_id)`,
)).map((p) => `${p.role_code}|${p.screen_id}|${p.action}|${p.scope_type}`);
const seedPerms = PHASE1_PERMISSIONS.map((p) => `${p.roleCode}|${p.screenId}|${p.action}|${p.scope}`);
check(`role_permission ${seedPerms.length}행이 seed/permissions.ts 와 정확히 일치`, sameSet(perms, seedPerms), `DB ${perms.length}행`);
const admin = await q<{ user_id: string; login_id: string; status: string; hash: string; roles: string[] }>(
  `SELECT u.user_id, u.login_id, u.status, left(u.password_hash, 7) hash,
          array_agg(r.role_code::text) FILTER (WHERE r.role_code IS NOT NULL) roles
     FROM user_account u LEFT JOIN user_role ur USING (user_id) LEFT JOIN role r USING (role_id)
    WHERE u.login_id = $1 GROUP BY u.user_id`,
  [process.env.SEED_ADMIN_LOGIN_ID],
);
check('SYS_ADMIN 시드 (ACTIVE, SYS_ADMIN 역할, scrypt 해시)', admin.length === 1 && admin[0].status === 'ACTIVE' && admin[0].roles?.join() === 'SYS_ADMIN' && admin[0].hash === 'scrypt$');
const audits = await q<{ actor_type: string; n: number }>(`SELECT actor_type, count(*)::int n FROM audit_log WHERE reason LIKE 'seed:%' GROUP BY actor_type`);
check('시드 감사로그가 SYSTEM_BATCH 로 기록됨', audits.length === 1 && audits[0].actor_type === 'SYSTEM_BATCH', JSON.stringify(audits));
const leak = Number((await q(`SELECT count(*)::int n FROM audit_log WHERE after_value::text ILIKE '%scrypt%' OR after_value::text ILIKE '%password%'`))[0].n);
check('감사로그에 비밀번호·해시가 남지 않음', leak === 0);

// ── 3. 동작 검증 (모두 롤백) ───────────────────────────────────────────────
async function expectFail(name: string, sql: string, code: string, params: unknown[] = []): Promise<void> {
  await client.query('SAVEPOINT sp');
  try {
    await client.query(sql, params);
    check(name, false, '오류가 발생하지 않음(차단 실패)');
  } catch (error) {
    const e = error as { code?: string; message: string };
    check(name, e.code === code, `기대 ${code}, 실제 ${e.code}: ${e.message}`);
  }
  await client.query('ROLLBACK TO SAVEPOINT sp');
}
async function expectOk(name: string, sql: string, params: unknown[] = []): Promise<pg.QueryResult> {
  await client.query('SAVEPOINT sp');
  try {
    const r = await client.query(sql, params);
    check(name, true);
    await client.query('RELEASE SAVEPOINT sp');
    return r;
  } catch (error) {
    check(name, false, (error as Error).message);
    await client.query('ROLLBACK TO SAVEPOINT sp');
    throw error;
  }
}

await client.query('BEGIN');
try {
  const adminId = Number(admin[0].user_id);
  const one = async (sql: string, params: unknown[] = []): Promise<number> => Number((await client.query(sql, params)).rows[0].id);

  const courseId = await one(`INSERT INTO course (course_name, start_date, end_date, total_hours, training_site, manager_user_id) VALUES ('t', '2026-10-01', '2026-10-31', 100, 's', $1) RETURNING course_id id`, [adminId]);
  const instA = await one(`INSERT INTO instructor (name) VALUES ('A') RETURNING instructor_id id`);
  const instB = await one(`INSERT INTO instructor (name) VALUES ('B') RETURNING instructor_id id`);
  const traineeId = await one(`INSERT INTO trainee (name) VALUES ('T') RETURNING trainee_id id`);
  const seedScheduleId = await one(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 99, '2026-10-09', '09:00', '18:00', $2) RETURNING schedule_id id`, [courseId, instA]);
  const seedAttendanceId = await one(`INSERT INTO attendance (trainee_id, schedule_id, attendance_status, source_type) VALUES ($1, $2, 'PRESENT', 'MANUAL') RETURNING attendance_id id`, [traineeId, seedScheduleId]);
  const manualRuleId = Number((await client.query(`SELECT rule_id FROM detection_rule WHERE rule_code = 'MANUAL'`)).rows[0]?.rule_id);
  const seedCaseId = await one(
    `INSERT INTO verification_case (course_id, detection_rule_id, detected_at, evidence, status) VALUES ($1, $2, now(), '{"dedupe_key":"t","items":[{"id":"t"}]}', 'NEEDS_CHECK') RETURNING case_id id`,
    [courseId, manualRuleId],
  );
  const seedSubmissionId = await one(
    `INSERT INTO submission (trainee_id, course_id, title, submitted_at) VALUES ($1, $2, 't', now()) RETURNING submission_id id`,
    [traineeId, courseId],
  );

  // append-only: 행을 넣은 뒤 UPDATE / DELETE / TRUNCATE 시도 (23001 = restrict_violation)
  await client.query(`INSERT INTO trainee_change_log (entity_type, entity_id, changed_by, before_value, after_value, reason) VALUES ('TRAINEE', $1, $2, '{}', '{}', 't')`, [traineeId, adminId]);
  await client.query(`INSERT INTO instructor_change_log (entity_type, entity_id, changed_by, before_value, after_value, reason) VALUES ('INSTRUCTOR', $1, $2, '{}', '{}', 't')`, [instA, adminId]);
  await client.query(`INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, changed_by, before_value, after_value, reason) VALUES ($1, $2, 'USER', $3, '{}', '{}', 't')`, [seedAttendanceId, traineeId, adminId]);
  await client.query(`INSERT INTO verification_case_trainee (case_id, trainee_id, created_by) VALUES ($1, $2, $3)`, [seedCaseId, traineeId, adminId]);
  await client.query(`INSERT INTO verification_action_log (case_id, actor_id, action_type, new_status) VALUES ($1, $2, 'CHECK', 'IN_REVIEW')`, [seedCaseId, adminId]);
  await client.query(`INSERT INTO submission_review_log (submission_id, version, reviewer_id, review_result) VALUES ($1, 1, $2, 'APPROVED')`, [seedSubmissionId, adminId]);
  await client.query(
    `INSERT INTO attachment (entity_type, entity_id, entity_version, file_name, file_path, file_size, uploaded_by) VALUES ('SUBMISSION', $1, 1, 'a.txt', 'a.txt', 1, $2)`,
    [seedSubmissionId, adminId],
  );
  const UPDATE_COL: Record<string, string> = {
    audit_log: 'reason', trainee_change_log: 'reason', instructor_change_log: 'reason', attendance_change_log: 'reason',
    verification_case_trainee: 'attendance_id', verification_action_log: 'note',
    submission_review_log: 'review_comment', attachment: 'file_name',
  };
  for (const t of APPEND_ONLY) {
    await expectFail(`append-only: ${t} UPDATE 차단`, `UPDATE ${t} SET ${UPDATE_COL[t]} = NULL`, '23001');
    await expectFail(`append-only: ${t} DELETE 차단`, `DELETE FROM ${t}`, '23001');
    await expectFail(`append-only: ${t} TRUNCATE 차단`, `TRUNCATE ${t}`, '23001');
  }
  await expectOk('append-only: INSERT 는 허용 (audit_log)', `INSERT INTO audit_log (actor_type, action, target_table, target_id) VALUES ('SYSTEM_RULE', 'CREATE', 'x', 1)`);

  // 부분 유니크: 과정 전체 담당은 유효 배정 기준 course 당 1건
  const a1 = await one(`INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, NULL) RETURNING assignment_id id`, [instA, courseId]);
  await expectFail('부분 유니크: 과정 전체 담당 2명 차단', `INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, NULL)`, '23505', [instB, courseId]);
  await expectOk('부분 유니크: 회차별 배정은 허용', `INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, 1)`, [instB, courseId]);
  await client.query(`UPDATE instructor_assignment SET status = 'CANCELLED' WHERE assignment_id = $1`, [a1]);
  await expectOk('부분 유니크: 기존 배정 취소 후 다른 강사 전체 담당 허용', `INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, NULL)`, [instB, courseId]);

  // P1-02: 취소된 회차별 배정은 이력으로 남고 같은 키의 재배정은 신규 행. 유효 배정 중복은 차단
  const r1 = await one(`INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, 5) RETURNING assignment_id id`, [instA, courseId]);
  await expectFail('P1-02: 유효 배정 (강사, 과정, 회차) 중복 차단', `INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, 5)`, '23505', [instA, courseId]);
  await client.query(`UPDATE instructor_assignment SET status = 'CANCELLED' WHERE assignment_id = $1`, [r1]);
  await expectOk('P1-02: 취소 후 같은 (강사, 과정, 회차) 재배정은 신규 행으로 허용', `INSERT INTO instructor_assignment (instructor_id, course_id, round_no) VALUES ($1, $2, 5)`, [instA, courseId]);
  const assignRows = (await client.query(`SELECT count(*)::int n, count(*) FILTER (WHERE status = 'CANCELLED')::int c FROM instructor_assignment WHERE instructor_id = $1 AND course_id = $2 AND round_no = 5`, [instA, courseId])).rows[0];
  check('P1-02: 이전 취소 배정 이력이 보존됨', assignRows.n === 2 && assignRows.c === 1, JSON.stringify(assignRows));

  // UNIQUE / FK / enum / CHECK
  const scheduleId = await one(`INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 1, '2026-10-02', '09:00', '18:00', $2) RETURNING schedule_id id`, [courseId, instA]);
  await expectFail('UNIQUE(course_id, round_no) 차단', `INSERT INTO class_schedule (course_id, round_no, class_date, start_time, end_time, instructor_id) VALUES ($1, 1, '2026-10-03', '09:00', '18:00', $2)`, '23505', [courseId, instA]);
  await client.query(`INSERT INTO trainee_enrollment (trainee_id, course_id) VALUES ($1, $2)`, [traineeId, courseId]);
  await expectFail('유효 등록 건 중복(trainee_id, course_id) 차단', `INSERT INTO trainee_enrollment (trainee_id, course_id) VALUES ($1, $2)`, '23505', [traineeId, courseId]);
  // P1-01: 취소 건은 이력으로 남고 재신청은 신규 행, 재취소도 허용(취소 행은 여러 개 가능), 유효 건은 다시 1건으로 제한
  await client.query(`UPDATE trainee_enrollment SET status = 'CANCELLED', cancel_reason = '서류 미비' WHERE trainee_id = $1 AND course_id = $2`, [traineeId, courseId]);
  await expectOk('P1-01: 취소 후 같은 과정 재신청은 신규 행으로 허용', `INSERT INTO trainee_enrollment (trainee_id, course_id) VALUES ($1, $2)`, [traineeId, courseId]);
  await expectFail('P1-01: 재신청 후 유효 건 중복은 다시 차단', `INSERT INTO trainee_enrollment (trainee_id, course_id) VALUES ($1, $2)`, '23505', [traineeId, courseId]);
  await client.query(`UPDATE trainee_enrollment SET status = 'CANCELLED', cancel_reason = '재취소' WHERE trainee_id = $1 AND course_id = $2 AND status = 'APPLIED'`, [traineeId, courseId]);
  await expectOk('P1-01: 취소 행이 여러 개여도 신규 재신청 허용', `INSERT INTO trainee_enrollment (trainee_id, course_id) VALUES ($1, $2)`, [traineeId, courseId]);
  const enrollRows = (await client.query(`SELECT count(*)::int n, count(*) FILTER (WHERE status = 'CANCELLED')::int c FROM trainee_enrollment WHERE trainee_id = $1 AND course_id = $2`, [traineeId, courseId])).rows[0];
  check('P1-01: 이전 취소 이력(사유 포함)이 삭제되지 않고 보존됨', enrollRows.n === 3 && enrollRows.c === 2, JSON.stringify(enrollRows));
  await expectFail('FK: 존재하지 않는 manager_user_id 차단', `INSERT INTO course (course_name, start_date, end_date, total_hours, training_site, manager_user_id) VALUES ('t','2026-10-01','2026-10-31',1,'s',999999999)`, '23503');
  await expectFail('enum: 잘못된 course.status 차단', `UPDATE course SET status = 'BOGUS' WHERE course_id = $1`, '22P02', [courseId]);
  await expectFail('CHECK: 종료일 < 시작일 차단', `UPDATE course SET end_date = '2020-01-01' WHERE course_id = $1`, '23514', [courseId]);
  await expectFail('CHECK: role_permission.screen_id 형식(S30 차단)', `INSERT INTO role_permission (role_id, screen_id, action) SELECT role_id, 'S30', 'R' FROM role LIMIT 1`, '23514');
  await expectFail('UNIQUE: 강사 1인 1계정 (linked_instructor_id)', `INSERT INTO user_account (login_id, password_hash, name, linked_instructor_id) VALUES ('dup1','h','n',$1),('dup2','h','n',$1)`, '23505', [instA]);

  // attendance: 동일 (trainee_id, schedule_id) 중복 차단(C1), enum·CHECK
  await expectFail('UNIQUE(trainee_id, schedule_id) 중복 출결 차단', `INSERT INTO attendance (trainee_id, schedule_id, attendance_status, source_type) VALUES ($1, $2, 'ABSENT', 'MANUAL')`, '23505', [traineeId, seedScheduleId]);
  await expectFail('enum: 잘못된 attendance_status 차단', `UPDATE attendance SET attendance_status = 'BOGUS' WHERE attendance_id = $1`, '22P02', [seedAttendanceId]);
  await expectFail('attendance_change_log CHECK: USER 인데 changed_by 없음 차단', `INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, before_value, after_value, reason) VALUES ($1, $2, 'USER', '{}', '{}', 't')`, '23514', [seedAttendanceId, traineeId]);
  await expectFail('attendance_change_log CHECK: SYSTEM_BATCH 인데 changed_by 지정 차단', `INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, changed_by, before_value, after_value, reason) VALUES ($1, $2, 'SYSTEM_BATCH', $3, '{}', '{}', 't')`, '23514', [seedAttendanceId, traineeId, adminId]);
  await expectOk('attendance_change_log: SYSTEM_BATCH 는 changed_by 없이 허용(공식 대사)', `INSERT INTO attendance_change_log (attendance_id, trainee_id, actor_type, before_value, after_value, reason) VALUES ($1, $2, 'SYSTEM_BATCH', '{}', '{}', '공식 출결 대사 반영')`, [seedAttendanceId, traineeId]);

  // operation_log / course_issue: UNIQUE(schedule_id), CHECK, enum
  await client.query(
    `INSERT INTO operation_log (schedule_id, instructor_id, content, participant_count, author_id, written_at) VALUES ($1, $2, 'c', 1, $3, now())`,
    [seedScheduleId, instA, adminId],
  );
  await expectFail('UNIQUE(schedule_id) 회차당 운영일지 1건 차단', `INSERT INTO operation_log (schedule_id, instructor_id, content, participant_count, author_id, written_at) VALUES ($1, $2, 'c2', 1, $2, now())`, '23505', [seedScheduleId, instA]);
  await expectFail('CHECK: participant_count 음수 차단', `UPDATE operation_log SET participant_count = -1 WHERE schedule_id = $1`, '23514', [seedScheduleId]);
  await expectFail('enum: 잘못된 course_issue.category 차단', `INSERT INTO course_issue (course_id, category, content, reported_by, reported_at) VALUES ($1, 'BOGUS', 'x', $2, now())`, '22P02', [courseId, adminId]);
  await expectOk('course_issue: schedule_id 없이(과정 전체 이슈) 등록 허용', `INSERT INTO course_issue (course_id, category, content, reported_by, reported_at) VALUES ($1, 'FACILITY', 'x', $2, now())`, [courseId, adminId]);

  // attendance_setting(D-08): 단일 행·유예분 범위
  await expectFail('CHECK: attendance_setting 은 단일 행(setting_id = 1)만 허용', `INSERT INTO attendance_setting (setting_id) VALUES (2)`, '23514');
  await expectFail('CHECK: attendance_setting.late_grace_minutes 범위(0~240) 밖 차단', `UPDATE attendance_setting SET late_grace_minutes = 241`, '23514');

  // detection_rule / verification_case / verification_case_trainee: UNIQUE, CHECK, enum, PK
  await expectFail('UNIQUE(rule_code) 중복 탐지규칙 차단', `INSERT INTO detection_rule (rule_code, rule_name, initial_status, params) VALUES ('MANUAL', 'dup', 'NEEDS_CHECK', '{}')`, '23505');
  await expectFail('CHECK: detection_rule.initial_status 는 NEEDS_CHECK/PRIORITY_CHECK 만 허용', `INSERT INTO detection_rule (rule_code, rule_name, initial_status, params) VALUES ('X_TEST', 'x', 'CONFIRMED', '{}')`, '23514');
  await expectFail('enum: 잘못된 verification_case.status 차단', `UPDATE verification_case SET status = 'BOGUS' WHERE case_id = $1`, '22P02', [seedCaseId]);
  await expectFail('PK(case_id, trainee_id) 중복 verification_case_trainee 차단', `INSERT INTO verification_case_trainee (case_id, trainee_id) VALUES ($1, $2)`, '23505', [seedCaseId, traineeId]);
  await expectFail('enum: 잘못된 verification_action_log.action_type 차단', `INSERT INTO verification_action_log (case_id, actor_id, action_type, new_status) VALUES ($1, $2, 'BOGUS', 'IN_REVIEW')`, '22P02', [seedCaseId, adminId]);

  // audit_log CHECK
  await expectFail('audit CHECK: 시스템 행위자에 actor_user_id 지정 차단', `INSERT INTO audit_log (actor_type, actor_user_id, action, target_table, target_id) VALUES ('SYSTEM_BATCH', $1, 'CREATE', 'x', 1)`, '23514', [adminId]);
  await expectFail('audit CHECK: USER 인데 actor_user_id 없음(LOGIN_FAILED 제외) 차단', `INSERT INTO audit_log (actor_type, action, target_table, target_id) VALUES ('USER', 'CREATE', 'x', 1)`, '23514');
  await expectFail('audit CHECK: target_id 없음(LOGIN_FAILED·ACCESS_DENIED 제외) 차단', `INSERT INTO audit_log (actor_type, actor_user_id, action, target_table) VALUES ('USER', $1, 'CREATE', 'x')`, '23514', [adminId]);
  await expectOk('audit CHECK: 존재하지 않는 계정의 LOGIN_FAILED 허용', `INSERT INTO audit_log (actor_type, action, target_table, reason) VALUES ('USER', 'LOGIN_FAILED', 'user_account', 'bad password')`);
  await expectOk('audit CHECK: ACCESS_DENIED target_id NULL 허용', `INSERT INTO audit_log (actor_type, actor_user_id, action, target_table) VALUES ('USER', $1, 'ACCESS_DENIED', 'course')`, [adminId]);

  // updated_at 트리거 (같은 트랜잭션에서는 now() 가 같으므로 과거값으로 넣고 갱신 여부 확인)
  // UPDATE 에서 updated_at 을 과거로 지정해도 트리거가 now() 로 덮어써야 한다
  await client.query(`UPDATE course SET course_name = 't2', updated_at = '2000-01-01T00:00:00Z' WHERE course_id = $1`, [courseId]);
  const touched = (await client.query(`SELECT updated_at, now() AS tx_now FROM course WHERE course_id = $1`, [courseId])).rows[0] as { updated_at: Date; tx_now: Date };
  check('updated_at 트리거가 UPDATE 시 now() 로 자동 갱신(수동 값 덮어씀)', touched.updated_at.getTime() === touched.tx_now.getTime());
} finally {
  await client.query('ROLLBACK');
}

const leftover = Number((await q(`SELECT count(*)::int n FROM course WHERE course_name IN ('t','t2')`))[0].n);
const leftoverAttendance = Number((await q(`SELECT count(*)::int n FROM attendance`))[0].n);
check('검증 데이터가 롤백되어 남지 않음', leftover === 0 && leftoverAttendance === 0, `course=${leftover}, attendance=${leftoverAttendance}`);
const finalCounts = (await q(`SELECT (SELECT count(*) FROM role)::int r, (SELECT count(*) FROM role_permission)::int p, (SELECT count(*) FROM user_account)::int u, (SELECT count(*) FROM audit_log)::int a`))[0];
check('롤백 후 행 수 유지 (역할 4 / 권한 시드 / 사용자 1 / 감사로그는 검증 시작 시점과 동일)', finalCounts.r === 4 && finalCounts.p === seedPerms.length && finalCounts.u === 1 && finalCounts.a === auditAtStart, JSON.stringify({ ...finalCounts, auditAtStart }));

await client.end();
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  → ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} 통과${failed.length ? `, 실패 ${failed.length}건` : ''}`);
process.exit(failed.length ? 1 : 0);
