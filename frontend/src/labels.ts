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

export const ASSIGNMENT_STATUS_LABELS: Record<string, string> = {
  ASSIGNED: '배정',
  CANCELLED: '배정 취소',
}

