// baseline 3-4: verification_case.status 7종 + 종결/미종결 분류. verification_action_log.action_type 5종.
export const CASE_STATUSES = ['NEEDS_CHECK', 'PRIORITY_CHECK', 'IN_REVIEW', 'CONFIRMED', 'ACTION_REQUIRED', 'ACTION_DONE', 'FOLLOW_UP'] as const;
export const TERMINAL_STATUSES = ['CONFIRMED', 'ACTION_DONE'] as const;
export const ACTIVE_STATUSES = CASE_STATUSES.filter((s) => !(TERMINAL_STATUSES as readonly string[]).includes(s));
export const ACTION_TYPES = ['CHECK', 'ACTION_ENTRY', 'CLOSE', 'REOPEN', 'STATUS_CHANGE'] as const;
