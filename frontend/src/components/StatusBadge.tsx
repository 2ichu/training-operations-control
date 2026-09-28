import { CASE_STATUS_LABELS, COURSE_STATUS_LABELS, label } from '../labels'

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

// 과정 상태는 강조색 없이 표시하고, 종료·중단(최종 상태)만 흐리게 구분한다(포인트 컬러 최소화 원칙)
export function CourseStatusBadge({ status }: { status: string }) {
  const tone = status === 'CLOSED' || status === 'SUSPENDED' ? 'muted' : 'neutral'
  return <span className={`badge badge-${tone}`}>{label(COURSE_STATUS_LABELS, status)}</span>
}
