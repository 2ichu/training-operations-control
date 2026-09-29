import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { ClosureItem, CourseDetail } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { CourseStatusBadge } from '../../components/StatusBadge'
import { formatDateTime, formatTime } from '../../format'
import { ASSIGNMENT_STATUS_LABELS, ENROLLMENT_STATUS_LABELS, ENROLLMENT_STATUS_ORDER, label, SCHEDULE_STATUS_LABELS } from '../../labels'
import { NotFoundPage } from '../PlaceholderPages'
import { ClosureChecklistTable } from './ClosureChecklist'
import { CourseActions } from './CourseActions'
import { CourseForm } from './CourseForm'
import type { CourseFormValues } from './course-model'

type Tab = 'trainees' | 'assignments' | 'schedules' | 'closure'

// S16 과정 상세(system-design 7-A): 기본정보 + 상태 전환 + 탭(훈련생 / 강사배정 / 교육일정 / 종료 체크리스트).
// 강사에게는 서버가 본인 배정·본인 회차만 내려준다(V4). 종료·중단 과정은 수정할 수 없다(V7).
export function CourseDetailPage() {
  const { id } = useParams()
  const courseId = Number(id)
  const { can } = useAuth()
  const detail = useApi((signal) => api.get<CourseDetail>(`/courses/${courseId}`, undefined, signal), String(courseId))
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<Tab>('trainees')
  const [notice, setNotice] = useState<string | null>(null)

  if (!Number.isInteger(courseId) || courseId <= 0) return <NotFoundPage />
  if (detail.status === 'error' && detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />

  const course = detail.data
  const locked = course ? course.status === 'CLOSED' || course.status === 'SUSPENDED' : false
  const canUpdate = can('S16', 'U')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'trainees', label: '훈련생' },
    { key: 'assignments', label: '강사배정' },
    { key: 'schedules', label: '교육일정' },
    ...(can('S16', 'A') ? [{ key: 'closure' as const, label: '종료 체크리스트' }] : []),
  ]

  return (
    <section className="page">
      <div className="page-header">
        <h1>{course ? course.courseName : '과정 상세'}</h1>
        <Link to="/courses">목록으로</Link>
      </div>
      {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
      {!course && detail.status === 'loading' && <p className="muted">불러오는 중…</p>}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      {course && editing && (
        <CourseForm
          mode="edit"
          initial={toFormValues(course)}
          currentManager={{ userId: course.managerUserId, name: course.managerName ?? `#${course.managerUserId}` }}
          onSubmit={async (body) => {
            await api.patch(`/courses/${courseId}`, body)
            setEditing(false)
            setNotice('저장했습니다.')
            detail.reload()
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {course && !editing && (
        <div className={detail.status === 'loading' ? 'case-detail is-refreshing' : 'case-detail'}>
          <section className="panel" aria-label="기본정보">
            <dl className="summary-grid">
              <div>
                <dt>상태</dt>
                <dd>
                  <CourseStatusBadge status={course.status} />
                </dd>
              </div>
              <div>
                <dt>기간</dt>
                <dd>
                  <span className="nowrap">{course.startDate}</span> ~ <span className="nowrap">{course.endDate}</span>
                </dd>
              </div>
              <div>
                <dt>총교육시간</dt>
                <dd>{course.totalHours}시간</dd>
              </div>
              <div>
                <dt>교육장</dt>
                <dd>{course.trainingSite}</dd>
              </div>
              <div>
                <dt>담당자</dt>
                <dd>{course.managerName ?? '-'}</dd>
              </div>
              <div>
                <dt>최종 수정</dt>
                <dd>{formatDateTime(course.updatedAt)}</dd>
              </div>
            </dl>
            {canUpdate && !locked && (
              <div className="toolbar">
                <button type="button" onClick={() => setEditing(true)}>
                  수정
                </button>
                <CourseActions
                  course={course}
                  onChanged={() => {
                    setNotice('상태를 변경했습니다.')
                    detail.reload()
                  }}
                />
              </div>
            )}
            {locked && <p className="muted">종료·중단된 과정은 정보와 하위 데이터를 변경할 수 없습니다.</p>}
          </section>

          <section className="panel">
            <div className="tabs" role="tablist" aria-label="과정 상세">
              {tabs.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" aria-label={tabs.find((t) => t.key === tab)?.label}>
              {tab === 'trainees' && <TraineeTab course={course} />}
              {tab === 'assignments' && <AssignmentTab course={course} />}
              {tab === 'schedules' && <ScheduleTab course={course} />}
              {tab === 'closure' && <ClosureTab courseId={course.courseId} />}
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

function toFormValues(c: CourseDetail): CourseFormValues {
  return {
    courseName: c.courseName,
    startDate: c.startDate,
    endDate: c.endDate,
    totalHours: String(c.totalHours),
    trainingSite: c.trainingSite,
    managerUserId: String(c.managerUserId),
  }
}

function TraineeTab({ course }: { course: CourseDetail }) {
  const { can } = useAuth()
  const counts = new Map(course.traineeSummary.map((s) => [s.status, s.count]))
  const rows = ENROLLMENT_STATUS_ORDER.filter((s) => counts.has(s))
  const links = (
    <p className="toolbar">
      {can('S03', 'R') && <Link to={`/trainees?course_id=${course.courseId}`}>훈련생 목록에서 보기</Link>}
      {can('S02', 'R') && <Link to={`/enrollments?course_id=${course.courseId}`}>대상자 확인에서 보기</Link>}
    </p>
  )
  if (rows.length === 0)
    return (
      <>
        <EmptyText>등록된 훈련생이 없습니다.</EmptyText>
        {links}
      </>
    )
  return (
    <>
    {links}
    <table className="compact">
      <thead>
        <tr>
          <th>등록 상태</th>
          <th className="num">인원</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s}>
            <td>{label(ENROLLMENT_STATUS_LABELS, s)}</td>
            <td className="num">{counts.get(s)}명</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  )
}

// 배정 추가·취소와 회차 편성은 교육일정 화면(S13)에서 한다(system-design 3.3 — 별도 배정 메뉴 없음)
function ScheduleLink({ courseId }: { courseId: number }) {
  const { can } = useAuth()
  if (!can('S13', 'R')) return null
  return (
    <p className="toolbar">
      <Link to={`/schedules?course_id=${courseId}`}>교육일정·강사 배정 관리</Link>
    </p>
  )
}

function AssignmentTab({ course }: { course: CourseDetail }) {
  if (course.instructorAssignments.length === 0)
    return (
      <>
        <ScheduleLink courseId={course.courseId} />
        <EmptyText>배정된 강사가 없습니다.</EmptyText>
      </>
    )
  return (
    <>
    <ScheduleLink courseId={course.courseId} />
    <table>
      <thead>
        <tr>
          <th>강사</th>
          <th>범위</th>
          <th>상태</th>
          <th>배정일시</th>
        </tr>
      </thead>
      <tbody>
        {course.instructorAssignments.map((a) => (
          <tr key={a.assignmentId}>
            <td>{a.instructorName}</td>
            <td>{a.roundNo === null ? '과정 전체' : `${a.roundNo}회차`}</td>
            <td>{label(ASSIGNMENT_STATUS_LABELS, a.status)}</td>
            <td>{formatDateTime(a.assignedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  )
}

function ScheduleTab({ course }: { course: CourseDetail }) {
  if (course.schedules.length === 0)
    return (
      <>
        <ScheduleLink courseId={course.courseId} />
        <EmptyText>등록된 교육일정이 없습니다.</EmptyText>
      </>
    )
  const names = new Map(course.instructorAssignments.map((a) => [a.instructorId, a.instructorName]))
  return (
    <>
    <ScheduleLink courseId={course.courseId} />
    <table>
      <thead>
        <tr>
          <th>회차</th>
          <th>일자</th>
          <th>시간</th>
          <th>강사</th>
          <th>상태</th>
        </tr>
      </thead>
      <tbody>
        {course.schedules.map((s) => (
          <tr key={s.scheduleId}>
            <td>{s.roundNo}회차</td>
            <td>{s.classDate}</td>
            <td>
              {formatTime(s.startTime)}~{formatTime(s.endTime)}
            </td>
            <td>{names.get(s.instructorId) ?? '-'}</td>
            <td>{label(SCHEDULE_STATUS_LABELS, s.displayStatus)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  )
}

function ClosureTab({ courseId }: { courseId: number }) {
  const checklist = useApi((signal) => api.get<{ items: ClosureItem[] }>(`/courses/${courseId}/closure-checklist`, undefined, signal), String(courseId))
  if (checklist.status === 'error') return <ErrorText error={checklist.error} onRetry={checklist.reload} />
  if (!checklist.data) return <p className="muted">불러오는 중…</p>
  return (
    <>
      <p className="hint">현재 시점 기준입니다. 종료 처리 시 다시 검사합니다.</p>
      <ClosureChecklistTable items={checklist.data.items} courseId={courseId} />
    </>
  )
}
