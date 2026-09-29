// 상태 코드 → 한글 표시명 (baseline 3절 상태값 사전의 표시명, 역할명은 seed/roles.ts). 알 수 없는 코드는 코드 그대로 보여준다.

export const ROLE_LABELS: Record<string, string> = {
  SYS_ADMIN: '시스템 관리자',
  OPS_MANAGER: '과정 운영 담당자',
  INSTRUCTOR: '강사',
  EXECUTIVE: '관리자/책임자',
}

export const COURSE_STATUS_LABELS: Record<string, string> = {
  PREPARING: '준비중',
  RECRUITING: '모집중',
  IN_PROGRESS: '운영중',
  CLOSED: '종료',
  SUSPENDED: '중단',
}

export const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: '예정',
  CANCELLED: '휴강',
  COMPLETED: '진행완료',
}

// baseline 3-4: 확인 건 7개 중립 상태
export const CASE_STATUS_LABELS: Record<string, string> = {
  NEEDS_CHECK: '확인필요',
  PRIORITY_CHECK: '우선확인',
  IN_REVIEW: '확인중',
  CONFIRMED: '확인완료',
  ACTION_REQUIRED: '조치필요',
  ACTION_DONE: '조치완료',
  FOLLOW_UP: '추가확인',
}
export const CASE_STATUS_ORDER = Object.keys(CASE_STATUS_LABELS)

// detection_rule 시드(backend/seed/detection-rules.ts)의 규칙명
export const RULE_LABELS: Record<string, string> = {
  RULE_01: '동일 환경 복수 출결',
  RULE_02: '짧은 시간 내 복수 계정 출결',
  RULE_03: '회차 운영기록 지연',
  RULE_04: '퇴실정보 누락',
  RULE_05: '반복적인 출결 수정',
  RULE_06: '출결상태 반복 변경',
  RULE_07: '공식-내부 정보 불일치',
  MANUAL: '수동',
}

export const label = (dict: Record<string, string>, code: string): string => dict[code] ?? code

// verification_action_log.action_type (backend verification.constants.ts)
export const ACTION_TYPE_LABELS: Record<string, string> = {
  CHECK: '확인 시작',
  ACTION_ENTRY: '조치 필요 기록',
  CLOSE: '종결',
  REOPEN: '재오픈',
  STATUS_CHANGE: '상태 변경',
}

// 진행중(미종결) 상태 — S22 기본 필터(system-design 7.2 "기본값=진행중 상태만", baseline 3-4 종결=확인완료·조치완료)
export const ACTIVE_CASE_STATUSES = ['NEEDS_CHECK', 'PRIORITY_CHECK', 'IN_REVIEW', 'ACTION_REQUIRED', 'FOLLOW_UP']

// course_issue.category (system-design 5.3: 시설/민원/안전/기타)
export const ISSUE_CATEGORY_LABELS: Record<string, string> = {
  FACILITY: '시설',
  COMPLAINT: '민원',
  SAFETY: '안전',
  OTHER: '기타',
}

// trainee_enrollment.status (baseline 3-2)
export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  APPLIED: '신청',
  REVIEWING: '서류확인중',
  CONFIRMED: '확정',
  COMPLETED: '수료',
  DROPPED: '중도포기',
  EXPELLED: '제적',
  CANCELLED: '취소',
}
export const ENROLLMENT_STATUS_ORDER = Object.keys(ENROLLMENT_STATUS_LABELS)

// instructor.status (baseline 3절)
export const INSTRUCTOR_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '활동',
  INACTIVE: '비활동',
}

// user_account.status
export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '활성',
  INACTIVE: '비활성',
}

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  ASSIGNED: '배정',
  CANCELLED: '배정 취소',
}

// attendance 표시 상태(baseline 3-3). NOT_CHECKED 는 저장하지 않는 계산값
export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  NOT_CHECKED: '미출결',
  PRESENT: '출석',
  LATE: '지각',
  EARLY_LEAVE: '조퇴',
  ABSENT: '결석',
  EXCUSED: '인정결석',
}

// submission(baseline 3-5)
export const SUBMIT_STATUS_LABELS: Record<string, string> = {
  NOT_SUBMITTED: '미제출',
  SUBMITTED: '제출됨',
  LATE_SUBMITTED: '기한후제출',
}
export const REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: '대기',
  APPROVED: '적합',
  REVISION_REQUESTED: '보완요청',
  REJECTED: '부적합',
}

// attendance.source_type (baseline 3-3)
export const SOURCE_TYPE_LABELS: Record<string, string> = {
  OFFICIAL: '공식',
  MANUAL: '내부수기',
  LINKED: '연계자동',
}

// S08 매트릭스 셀 약어
export const ATTENDANCE_SHORT_LABELS: Record<string, string> = {
  NOT_CHECKED: '미',
  PRESENT: '출',
  LATE: '지',
  EARLY_LEAVE: '조',
  ABSENT: '결',
  EXCUSED: '인',
}


// operation_log 작성 여부(S17). 미작성은 저장하지 않는 계산값
export const OPERATION_LOG_STATUS_LABELS: Record<string, string> = {
  WRITTEN: '작성',
  NOT_WRITTEN: '미작성',
}

// course_issue.status (baseline 3-8)
export const ISSUE_STATUS_LABELS: Record<string, string> = {
  REGISTERED: '등록',
  IN_REVIEW: '확인중',
  RESOLVED: '조치완료',
}

// 화면 ID → 화면명(system-design 7-A 화면 목록, S28 은 Phase 5 추가) — S26 권한 매트릭스 행 이름
export const SCREEN_NAMES: Record<string, string> = {
  S01: '대시보드',
  S02: '대상자 확인',
  S03: '훈련생 목록',
  S04: '훈련생 등록/수정',
  S05: '훈련생 상세',
  S06: '훈련생 변경이력',
  S07: '일일 출결',
  S08: '과정별 출결',
  S09: '출결 수정',
  S10: '출결 수정이력',
  S11: '강사 목록',
  S12: '강사 등록/수정',
  S13: '강의 일정/교육일정',
  S14: '강사 변경이력',
  S15: '과정 목록',
  S16: '과정 등록/수정/상세',
  S17: '회차별 운영일지',
  S18: '특이사항',
  S19: '결과물 제출현황(미제출 포함)',
  S20: '결과물 미제출(S19 권한 사용)',
  S21: '결과물 검토',
  S22: '확인 필요 목록',
  S23: '확인 필요 상세',
  S24: '조치이력',
  S25: '사용자',
  S26: '권한',
  S27: '감사로그',
  S28: '탐지규칙',
}

// role_permission.action (baseline 4-1)
export const PERMISSION_ACTION_LABELS: Record<string, string> = {
  C: '등록',
  R: '조회',
  U: '수정',
  D: '삭제',
  A: '확인처리',
}

// audit_log.action / actor_type
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: '생성',
  UPDATE: '수정',
  DELETE: '삭제',
  VIEW_SENSITIVE: '민감정보 조회',
  LOGIN: '로그인',
  LOGOUT: '로그아웃',
  LOGIN_FAILED: '로그인 실패',
  ACCESS_DENIED: '접근 거부',
}
export const ACTOR_TYPE_LABELS: Record<string, string> = {
  USER: '사용자',
  SYSTEM_RULE: '시스템(탐지규칙)',
  SYSTEM_BATCH: '시스템(배치)',
  SYSTEM_API: '시스템(연동)',
}

// role_permission.scope_type (system-design 5.3: 전체/본인담당)
export const SCOPE_LABELS: Record<string, string> = {
  ALL: '전체',
  OWN_ASSIGNED: '본인 담당',
}

// detection_rule.params 키 → 표시명(단위 포함). 키 자체는 규칙 로직과 묶여 있어 화면에서 추가·삭제하지 않는다(P5-02)
export const RULE_PARAM_LABELS: Record<string, string> = {
  min_trainees: '최소 훈련생 수(명)',
  window_minutes: '시간 범위(분)',
  min_events: '최소 출결 건수(건)',
  delay_hours: '지연 기준(시간)',
  window_days: '집계 기간(일)',
  min_changes: '최소 수정 횟수(회)',
  min_flips: '최소 반복 변경 횟수(회)',
}
