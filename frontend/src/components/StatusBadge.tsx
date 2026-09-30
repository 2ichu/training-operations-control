import { ATTENDANCE_SHORT_LABELS, ATTENDANCE_STATUS_LABELS, CASE_STATUS_LABELS, COURSE_STATUS_LABELS, INSTRUCTOR_STATUS_LABELS, label, REVIEW_STATUS_LABELS, SCHEDULE_STATUS_LABELS, SUBMIT_STATUS_LABELS } from '../labels'

// 상태 색 의미: 확인 필요=노랑, 조치 필요·우선·추가 확인=주황, 확인 중=파랑, 완료=초록. 색만으로 구분하지 않고 항상 텍스트를 함께 표시한다.
const TONE: Record<string, 'attention' | 'action' | 'info' | 'done' | 'muted' | 'neutral'> = {
  NEEDS_CHECK: 'attention',
  PRIORITY_CHECK: 'action',
  FOLLOW_UP: 'action',
  ACTION_REQUIRED: 'action',
  IN_REVIEW: 'info',
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

// 출결 상태. "미출결"은 저장값이 아닌 계산값이라 점선 테두리로 구분한다(system-design S07). 휴강 회차(null)는 표시만.
export function AttendanceBadge({ status, short = false }: { status: string | null; short?: boolean }) {
  if (status === null) return <span className="muted">{short ? '휴' : '휴강'}</span>
  const text = short ? label(ATTENDANCE_SHORT_LABELS, status) : label(ATTENDANCE_STATUS_LABELS, status)
  const title = short ? label(ATTENDANCE_STATUS_LABELS, status) : undefined
  return (
    <span className={status === 'NOT_CHECKED' ? 'badge badge-computed' : status === 'PRESENT' ? 'badge badge-neutral' : 'badge badge-muted'} title={title}>
      {text}
    </span>
  )
}


// 강사 상태: 비활동만 흐리게 구분한다
export function InstructorStatusBadge({ status }: { status: string }) {
  return <span className={status === 'ACTIVE' ? 'badge badge-neutral' : 'badge badge-muted'}>{label(INSTRUCTOR_STATUS_LABELS, status)}</span>
}

// 회차 상태(baseline 3-6): 저장값 예정·휴강 + 계산값 진행완료. 휴강·진행완료는 흐리게, 예정은 기본
export function ScheduleStatusBadge({ status }: { status: string }) {
  return <span className={status === 'SCHEDULED' ? 'badge badge-neutral' : 'badge badge-muted'}>{label(SCHEDULE_STATUS_LABELS, status)}</span>
}

// 제출 상태: "미제출"은 행이 없는 계산값이라 점선(출결 미출결과 같은 표시, C1)
export function SubmitStatusBadge({ status }: { status: string }) {
  return <span className={status === 'NOT_SUBMITTED' ? 'badge badge-computed' : 'badge badge-neutral'}>{label(SUBMIT_STATUS_LABELS, status)}</span>
}

// 검토 상태: 강조색은 확인필요 전용이라 쓰지 않는다(7.1). 적합만 완료색, 보완요청·부적합은 흐리게, 대기는 기본
export function ReviewStatusBadge({ status }: { status: string }) {
  const tone = status === 'APPROVED' ? 'done' : status === 'PENDING' ? 'neutral' : 'muted'
  return <span className={`badge badge-${tone}`}>{label(REVIEW_STATUS_LABELS, status)}</span>
}
