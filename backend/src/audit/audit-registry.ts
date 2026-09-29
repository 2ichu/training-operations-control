// 감사 대상 업무 테이블 등록부. 등록된 테이블만 AuditedTx 로 변경할 수 있고(테이블명 화이트리스트 = SQL 인젝션 방어),
// 개인정보 마스킹(baseline 10-1)·민감 컬럼 제외·전용 변경이력(*_change_log) 연동이 여기서 결정된다.
export interface AuditableTable {
  /** 기본키 컬럼(복합키 가능). audit_log.target_id 에는 첫 번째 컬럼 값이 기록된다 */
  pk: string[];
  /** full: created_*·updated_* / created: created_* 만 / none: 없음 */
  auditColumns: 'full' | 'created' | 'none';
  /** UPDATE 시 사유와 함께 전용 변경이력을 같은 트랜잭션에 남긴다(사유 필수, 사람 행위자만) */
  changeLog?: { table: 'trainee_change_log' | 'instructor_change_log'; entityType: string };
  /** 로그에 마스킹해 남길 컬럼 */
  mask?: Record<string, (value: unknown) => unknown>;
  /** 값을 아예 남기지 않는 컬럼('[REDACTED]' 표시만) */
  redact?: string[];
}

// 연락처: 마지막 4자리만 남김. 예) 010-1234-5678 → ***-****-5678
export const maskTail = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const keepFrom = Math.max(value.length - 4, 0);
  return [...value].map((ch, i) => (i < keepFrom && /[0-9A-Za-z가-힣]/.test(ch) ? '*' : ch)).join('');
};

// 생년월일: 연도만 남김. 예) 1990-03-05 → 1990-**-**
export const maskBirthDate = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  const year = value instanceof Date ? value.getFullYear() : Number(String(value).slice(0, 4));
  return Number.isFinite(year) ? `${year}-**-**` : '****-**-**';
};

export const AUDITABLE_TABLES: Record<string, AuditableTable> = {
  course: { pk: ['course_id'], auditColumns: 'full' },
  class_schedule: { pk: ['schedule_id'], auditColumns: 'full' },
  trainee: {
    pk: ['trainee_id'],
    auditColumns: 'full',
    changeLog: { table: 'trainee_change_log', entityType: 'TRAINEE' },
    mask: { contact: maskTail, birth_date: maskBirthDate },
  },
  trainee_enrollment: {
    pk: ['enrollment_id'],
    auditColumns: 'full',
    changeLog: { table: 'trainee_change_log', entityType: 'ENROLLMENT' },
  },
  instructor: {
    pk: ['instructor_id'],
    auditColumns: 'full',
    changeLog: { table: 'instructor_change_log', entityType: 'INSTRUCTOR' },
    mask: { contact: maskTail },
  },
  instructor_assignment: {
    pk: ['assignment_id'],
    auditColumns: 'full',
    changeLog: { table: 'instructor_change_log', entityType: 'ASSIGNMENT' },
  },
  user_account: { pk: ['user_id'], auditColumns: 'full', redact: ['password_hash'] },
  role: { pk: ['role_id'], auditColumns: 'full' },
  role_permission: { pk: ['role_id', 'screen_id', 'action'], auditColumns: 'full' },
  user_role: { pk: ['user_id', 'role_id'], auditColumns: 'created' },
  // attendance 는 created_at/by·updated_at/by 컬럼이 없다(ERD 그대로). 전용 이력(attendance_change_log)은
  // trainee/instructor_change_log 와 스키마가 달라(actor_type 지원) 이 레지스트리의 changeLog 로 표현할 수 없으므로
  // AttendanceService 가 S09 정정에서 직접 INSERT 한다(감사 미들웨어 자체는 수정하지 않음).
  attendance: { pk: ['attendance_id'], auditColumns: 'none' },
  // operation_log·course_issue 도 created_at/by·updated_at/by 가 없다(author_id·written_at / reported_by·reported_at
  // 이 그 역할을 대신함, ERD 그대로). 전용 change_log 가 없고 baseline 7절도 audit_log before/after 만 요구한다.
  operation_log: { pk: ['operation_log_id'], auditColumns: 'none' },
  course_issue: { pk: ['issue_id'], auditColumns: 'none' },
  // verification_case 도 created_at/by·updated_at/by 가 없다(detected_at/closed_at 이 그 역할, ERD 상세 컬럼표 그대로).
  // verification_case_trainee·verification_action_log 는 append-only 전용 구조라 create/update 경로를 쓰지 않고
  // 서비스가 같은 트랜잭션 안에서 tx.query() 로 직접 INSERT 한다(attendance_change_log 와 동일한 선례).
  verification_case: { pk: ['case_id'], auditColumns: 'none' },
  detection_rule: { pk: ['rule_id'], auditColumns: 'none' },
  // D-08 판정 유예분(단일 행). 감사컬럼 없이 audit_log before/after 로만 추적한다(detection_rule 과 동일).
  attendance_setting: { pk: ['setting_id'], auditColumns: 'none' },
  // 복합키(case_id, trainee_id)지만 대리키가 아닌 자연키라 tx.create() 에 그대로 넘길 수 있다(user_role 과 동일한 선례,
  // create() 는 PK 를 막지 않는다 — update() 만 막는다). created_by 는 auditColumns:'created' 로 자동 채운다
  // (시스템 행위자는 자동으로 NULL — 컬럼 코멘트 "SYSTEM_RULE 생성 시 NULL, MANUAL 생성 시 값 있음"과 일치).
  // baseline 7-22행: 기존 활성 건에 훈련생을 추가할 때만 감사 대상(최초 생성 시점은 7-21행, 감사 없음 — linkTrainee() 로 별도 처리).
  verification_case_trainee: { pk: ['case_id', 'trainee_id'], auditColumns: 'created' },
  // submission 도 created_at/by·updated_at/by 가 없다(submitted_at·version 이 그 역할, ERD 상세 컬럼표 그대로).
  // submission_review_log·attachment 는 attendance_change_log 와 달리 actor_type 다형성이 없는 단순 1회성 삽입이라
  // 그대로 tx.create() 로 쓴다(각각 CREATE 감사가 남고, 검토 저장 시 submission UPDATE 감사와 함께 baseline 7-20행과 일치).
  submission: { pk: ['submission_id'], auditColumns: 'none' },
  submission_review_log: { pk: ['log_id'], auditColumns: 'none' },
  attachment: { pk: ['attachment_id'], auditColumns: 'none' },
};
