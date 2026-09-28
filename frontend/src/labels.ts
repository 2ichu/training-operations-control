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
