// 정적 검증: DB 없이 PostgreSQL 실제 파서(libpg-query)로 마이그레이션 SQL 을 검사한다. SQL 을 실행하지 않는다.
//  1) Up/Down 섹션 존재  2) 구문·PL/pgSQL 파싱  3) FK 대상 테이블·enum 타입의 선행 생성
//  4) Down 이 Up 에서 만든 테이블을 역순으로 모두 삭제  5) baseline Phase 1 기대 사항(13개 테이블, append-only 트리거 등)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModule, parsePlPgSQLSync, parseSync } from 'libpg-query';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');

const EXPECTED_TABLES = [
  'user_account', 'role', 'user_role', 'role_permission', 'audit_log',
  'course', 'trainee', 'trainee_enrollment', 'trainee_change_log',
  'instructor', 'instructor_assignment', 'instructor_change_log', 'class_schedule',
  'attendance', 'attendance_change_log', 'operation_log', 'course_issue',
  'detection_rule', 'verification_case', 'verification_case_trainee', 'verification_action_log',
  'submission', 'submission_review_log', 'attachment', 'attendance_setting', 'attendance_source_raw',
  'excuse_request', 'excuse_evidence',
];
const APPEND_ONLY = [
  'audit_log', 'trainee_change_log', 'instructor_change_log', 'attendance_change_log',
  'verification_case_trainee', 'verification_action_log', 'submission_review_log', 'attachment', 'attendance_source_raw', 'excuse_evidence',
];
const UPDATED_AT_TABLES = [
  'user_account', 'role', 'role_permission', 'course', 'trainee',
  'trainee_enrollment', 'instructor', 'instructor_assignment', 'class_schedule',
];
// attendance·operation_log·course_issue·detection_rule·verification_case 는 ERD 상 created_at/by·updated_at/by 가 없다
// (attendance 는 last_modified_at 이 S09 정정 시에만 채워지고, operation_log/course_issue 는 author_id·written_at
//  / reported_by·reported_at 이 생성 정보를 대신하며, detection_rule/verification_case 는 §5.3 상세 컬럼표에 애초에
//  없다 — detected_at/closed_at 이 그 역할을 대신하고 수정 추적은 audit_log before/after 만으로 처리한다).
const EXPECTED_ENUMS: Record<string, string[]> = {
  course_status: ['PREPARING', 'RECRUITING', 'IN_PROGRESS', 'CLOSED', 'SUSPENDED'],
  enrollment_status: ['APPLIED', 'REVIEWING', 'CONFIRMED', 'COMPLETED', 'DROPPED', 'EXPELLED', 'CANCELLED'],
  schedule_status: ['SCHEDULED', 'CANCELLED'],
  audit_actor_type: ['USER', 'SYSTEM_RULE', 'SYSTEM_BATCH', 'SYSTEM_API'],
  audit_action: ['CREATE', 'UPDATE', 'DELETE', 'VIEW_SENSITIVE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'ACCESS_DENIED'],
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

const errors: string[] = [];
const fail = (message: string): void => {
  errors.push(message);
};

type Node = Record<string, any>;
const strings = (names: Node[] = []): string[] => names.map((n) => n.String?.sval as string);

function splitSections(file: string, sql: string): { up: string; down: string } | null {
  const upIdx = sql.indexOf('-- Up Migration');
  const downIdx = sql.indexOf('-- Down Migration');
  if (upIdx < 0 || downIdx < 0 || downIdx < upIdx) {
    fail(`${file}: '-- Up Migration' / '-- Down Migration' 섹션이 올바르지 않음`);
    return null;
  }
  return { up: sql.slice(upIdx, downIdx), down: sql.slice(downIdx) };
}

await loadModule();

const createdTables: string[] = [];
const createdTypes = new Set<string>();
const enumValues = new Map<string, string[]>();
const droppedInDown: string[] = [];
const triggersByTable = new Map<string, string[]>();
const columnsByTable = new Map<string, Set<string>>();

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  const sql = readFileSync(join(dir, file), 'utf8');
  const sections = splitSections(file, sql);
  if (!sections) continue;

  let upStmts: Node[];
  let downStmts: Node[];
  try {
    upStmts = (parseSync(sections.up).stmts ?? []).map((s: Node) => s.stmt);
    downStmts = (parseSync(sections.down).stmts ?? []).map((s: Node) => s.stmt);
  } catch (error) {
    fail(`${file}: 구문 오류 — ${(error as Error).message}`);
    continue;
  }
  if (/CREATE\s+FUNCTION/i.test(sections.up)) {
    try {
      parsePlPgSQLSync(sections.up);
    } catch (error) {
      fail(`${file}: PL/pgSQL 구문 오류 — ${(error as Error).message}`);
    }
  }

  for (const stmt of upStmts) {
    if (stmt.CreateEnumStmt) {
      const name = strings(stmt.CreateEnumStmt.typeName).at(-1)!;
      createdTypes.add(name);
      enumValues.set(name, stmt.CreateEnumStmt.vals.map((v: Node) => v.String.sval));
    }
    if (stmt.CreateStmt) {
      const table = stmt.CreateStmt.relation.relname as string;
      const cols = new Set<string>();
      for (const elt of stmt.CreateStmt.tableElts as Node[]) {
        const refs: string[] = [];
        if (elt.ColumnDef) {
          cols.add(elt.ColumnDef.colname);
          const typeName = strings(elt.ColumnDef.typeName?.names).at(-1)!;
          if (!typeName.startsWith('int') && !['varchar', 'text', 'bool', 'date', 'time', 'timestamptz', 'jsonb', 'numeric', 'uuid'].includes(typeName) && !createdTypes.has(typeName)) {
            fail(`${file}: ${table}.${elt.ColumnDef.colname} 이(가) 아직 생성되지 않은 타입 '${typeName}' 사용`);
          }
          for (const c of (elt.ColumnDef.constraints ?? []) as Node[]) {
            if (c.Constraint.contype === 'CONSTR_FOREIGN') refs.push(c.Constraint.pktable.relname);
          }
        } else if (elt.Constraint?.contype === 'CONSTR_FOREIGN') {
          refs.push(elt.Constraint.pktable.relname);
        }
        for (const ref of refs) {
          if (ref !== table && !createdTables.includes(ref)) fail(`${file}: ${table} 의 FK 대상 '${ref}' 가 먼저 생성되지 않음`);
        }
      }
      createdTables.push(table);
      columnsByTable.set(table, cols);
    }
    if (stmt.AlterTableStmt) {
      const table = stmt.AlterTableStmt.relation.relname as string;
      for (const cmd of stmt.AlterTableStmt.cmds as Node[]) {
        const c = cmd.AlterTableCmd?.def?.Constraint;
        if (c?.contype === 'CONSTR_FOREIGN' && !createdTables.includes(c.pktable.relname)) {
          fail(`${file}: ALTER ${table} 의 FK 대상 '${c.pktable.relname}' 가 먼저 생성되지 않음`);
        }
      }
    }
    if (stmt.CreateTrigStmt) {
      const table = stmt.CreateTrigStmt.relation.relname as string;
      const fn = strings(stmt.CreateTrigStmt.funcname).at(-1)!;
      triggersByTable.set(table, [...(triggersByTable.get(table) ?? []), fn]);
    }
  }

  for (const stmt of downStmts) {
    if (stmt.DropStmt?.removeType === 'OBJECT_TABLE') {
      for (const obj of stmt.DropStmt.objects as Node[]) droppedInDown.push(strings(obj.List.items).at(-1)!);
    }
  }
}

const report = (): void => {
  if (errors.length > 0) {
    console.error(`정적 검증 실패 (${errors.length}건)\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
};
report(); // 파싱 실패 시 이후 검사는 의미가 없으므로 여기서 중단

// 4) Down 은 Up 에서 만든 테이블을 역순으로 삭제해야 한다(파일 순서 역순)
const expectedDropOrder = [...createdTables].reverse();
const dropOrderByFile: string[] = [];
for (const file of [...files].reverse()) {
  const sql = readFileSync(join(dir, file), 'utf8');
  const sections = splitSections(file, sql);
  if (!sections) continue;
  for (const stmt of (parseSync(sections.down).stmts ?? []).map((s: Node) => s.stmt)) {
    if (stmt.DropStmt?.removeType === 'OBJECT_TABLE') {
      for (const obj of stmt.DropStmt.objects as Node[]) dropOrderByFile.push(strings(obj.List.items).at(-1)!);
    }
  }
}
if (JSON.stringify(dropOrderByFile) !== JSON.stringify(expectedDropOrder)) {
  fail(`Down 삭제 순서가 생성 역순과 다름\n  기대: ${expectedDropOrder.join(', ')}\n  실제: ${dropOrderByFile.join(', ')}`);
}

// 5) baseline Phase 1 기대 사항
for (const table of EXPECTED_TABLES) if (!createdTables.includes(table)) fail(`기대 테이블 누락: ${table}`);
for (const table of createdTables) if (!EXPECTED_TABLES.includes(table)) fail(`Phase 1 범위 밖 테이블: ${table}`);
for (const table of APPEND_ONLY) {
  const fns = triggersByTable.get(table) ?? [];
  if (fns.filter((f) => f === 'forbid_modification').length < 2) fail(`${table}: append-only 트리거(UPDATE/DELETE, TRUNCATE) 누락`);
}
for (const table of UPDATED_AT_TABLES) {
  if (!(triggersByTable.get(table) ?? []).includes('set_updated_at')) fail(`${table}: updated_at 트리거 누락`);
  const cols = columnsByTable.get(table)!;
  for (const c of ['created_at', 'created_by', 'updated_at', 'updated_by']) if (!cols.has(c)) fail(`${table}: 공통 감사컬럼 ${c} 누락`);
}
for (const [name, values] of Object.entries(EXPECTED_ENUMS)) {
  if (JSON.stringify(enumValues.get(name)) !== JSON.stringify(values)) fail(`enum ${name} 값이 baseline 3절과 다름: ${JSON.stringify(enumValues.get(name))}`);
}

report();
console.log(`정적 검증 통과: 마이그레이션 ${files.length}개 파일, 테이블 ${createdTables.length}개, enum ${createdTypes.size}개 (SQL 은 실행하지 않음)`);
