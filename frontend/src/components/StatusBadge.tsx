import { CASE_STATUS_LABELS, label } from '../labels'

// system-design 7.1·7.2: 확인필요 계열만 강조색 1개, 종결은 연녹색, 확인중은 회색, 나머지는 무채색.
const TONE: Record<string, 'attention' | 'done' | 'muted' | 'neutral'> = {
  NEEDS_CHECK: 'attention',
  PRIORITY_CHECK: 'attention',
  IN_REVIEW: 'muted',
  CONFIRMED: 'done',
  ACTION_DONE: 'done',
}

export function CaseStatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${TONE[status] ?? 'neutral'}`}>{label(CASE_STATUS_LABELS, status)}</span>
}
