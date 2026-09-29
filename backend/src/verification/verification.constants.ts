// baseline 3-4: verification_case.status 7종 + 종결/미종결 분류. verification_action_log.action_type 5종.
export const CASE_STATUSES = ['NEEDS_CHECK', 'PRIORITY_CHECK', 'IN_REVIEW', 'CONFIRMED', 'ACTION_REQUIRED', 'ACTION_DONE', 'FOLLOW_UP'] as const;
export const TERMINAL_STATUSES = ['CONFIRMED', 'ACTION_DONE'] as const;
export const ACTIVE_STATUSES = CASE_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s));
export const ACTION_TYPES = ['CHECK', 'ACTION_ENTRY', 'CLOSE', 'REOPEN', 'STATUS_CHANGE'] as const;

// 도입하지 않기로 한 탐지규칙(2026-09-29, decisions.md P7-01). 출결은 등록 단말에 종속되지 않고 여러 기기로 자유롭게 입력되어
// 신뢰할 수 있는 단말 식별자가 없으므로 RULE_01(동일 단말)·RULE_02(출결 채널)는 탐지하지 않는다.
// 과거에 만들어진 rule 행·확인 건은 이력이라 지우지 않고, 사용 안 함으로 두며 S28 에서 다시 켤 수 없다.
export const RETIRED_RULE_CODES: readonly string[] = ['RULE_01', 'RULE_02'];
