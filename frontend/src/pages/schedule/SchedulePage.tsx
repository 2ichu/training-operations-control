import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { CourseDetail, InstructorListItem, Paged, ScheduleListItem } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { ScheduleStatusBadge } from '../../components/StatusBadge'
import { formatTime, todayKst } from '../../format'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { AssignmentPanel } from './AssignmentPanel'
import { ScheduleCalendar } from './ScheduleCalendar'
import { CancelClassDialog, ReassignDialog, ScheduleCreateDialog, ScheduleEditDialog } from './ScheduleDialogs'
import { isMonth, monthRange, shiftMonth } from './schedule-model'

const LIST_SIZE = 50
// 캘린더는 한 달치를 한 번에 가져온다(API 최대 페이지 크기)
const CALENDAR_SIZE = 100

type Dialog = { kind: 'create' } | { kind: 'edit' | 'cancel' | 'reassign'; schedule: ScheduleListItem }

// S13 강의 일정/교육일정(system-design 3.4·7-A): 데이터·화면은 하나, 진입점은 둘.
// - 강사 관리 > 강의 일정: 강사 기준, 캘린더 우선(강사 계정은 서버가 본인 회차만 준다)
// - 과정 운영 > 과정 상세 > 교육일정: course_id 지정, 회차 순 목록 우선 + 강사 배정 관리
// 운영담당자는 회차 추가·수정·휴강·강사 재배정과 배정 추가·취소를 한다. 종료·중단 과정은 바꿀 수 없다(V7).
// 회차를 누르면 그 회차의 운영일지(S17)로 간다.
export function SchedulePage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const instructorId = get('instructor_id')
  const view = get('view') === 'list' || get('view') === 'calendar' ? get('view') : courseId ? 'list' : 'calendar'
  const today = todayKst()
  const month = isMonth(get('month')) ? get('month') : today.slice(0, 7)
  const page = Number(get('page')) || 1
  const range = view === 'calendar' ? monthRange(month) : { from: get('from'), to: get('to') }
  const query = { course_id: courseId, instructor_id: instructorId, ...range, page: view === 'list' ? page : 1, size: view === 'list' ? LIST_SIZE : CALENDAR_SIZE }
  const schedules = useApi((signal) => api.get<Paged<ScheduleListItem>>('/schedules', query, signal), JSON.stringify(query))
  const courses = useCourseOptions()
  const instructors = useApi(
    (signal) => (can('S11', 'R') ? api.get<Paged<InstructorListItem>>('/instructors', { size: 100 }, signal).then((r) => r.items) : Promise.resolve([] as InstructorListItem[])),
    'instructors',
  )
  const course = useApi((signal) => (courseId ? api.get<CourseDetail>(`/courses/${courseId}`, undefined, signal) : Promise.resolve(null)), courseId)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const items = schedules.data?.items ?? []
  const courseData = courseId ? course.data : null
  const locked = courseData ? courseData.status === 'CLOSED' || courseData.status === 'SUSPENDED' : false
  const canUpdate = can('S13', 'U') && !locked

  const saved = (message: string) => {
    setDialog(null)
    setNotice(message)
    schedules.reload()
    if (courseId) course.reload()
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>{courseData ? `교육일정 — ${courseData.courseName}` : '강의 일정'}</h1>
        <div className="toolbar">
          {courseData && <Link to={`/courses/${courseData.courseId}`}>과정 상세로</Link>}
          {courseData && can('S13', 'C') && !locked && (
            <button type="button" className="button-primary" onClick={() => setDialog({ kind: 'create' })}>
              신규 회차 추가
            </button>
          )}
        </div>
      </div>

      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          과정
          <select value={courseId} onChange={(e) => set({ course_id: e.target.value })}>
            <option value="">전체</option>
            {courses.data?.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        {can('S11', 'R') && (instructors.data?.length ?? 0) > 1 && (
          <label>
            강사
            <select value={instructorId} onChange={(e) => set({ instructor_id: e.target.value })}>
              <option value="">전체</option>
              {instructors.data?.map((i) => (
                <option key={i.instructorId} value={i.instructorId}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {view === 'list' && (
          <>
            <label>
              기간(부터)
              <input type="date" value={get('from')} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label>
              기간(까지)
              <input type="date" value={get('to')} onChange={(e) => set({ to: e.target.value })} />
            </label>
          </>
        )}
        <div className="view-toggle" role="group" aria-label="보기">
          <button type="button" aria-pressed={view === 'calendar'} onClick={() => set({ view: 'calendar' })}>
            캘린더
          </button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => set({ view: 'list' })}>
            목록
          </button>
        </div>
      </form>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {locked && <p className="muted">종료·중단된 과정은 일정과 배정을 변경할 수 없습니다.</p>}
      {course.status === 'error' && <ErrorText error={course.error} onRetry={course.reload} />}
      {courseData && <AssignmentPanel course={courseData} locked={locked} onChanged={saved} />}

      {schedules.status === 'error' && <ErrorText error={schedules.error} onRetry={schedules.reload} />}
      {view === 'calendar' ? (
        <div className={schedules.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
          <div className="panel-header">
            <h2>{month.replace('-', '년 ')}월</h2>
            <div className="toolbar">
              <button type="button" onClick={() => set({ month: shiftMonth(month, -1) })}>
                이전 달
              </button>
              <button type="button" onClick={() => set({ month: undefined })}>
                이번 달
              </button>
              <button type="button" onClick={() => set({ month: shiftMonth(month, 1) })}>
                다음 달
              </button>
            </div>
          </div>
          {schedules.data && schedules.data.total > schedules.data.items.length && (
            <p className="hint">
              이 달의 일정이 많아 {schedules.data.items.length}건만 표시합니다. 과정·강사를 선택하거나 목록 보기를 이용해 주세요.
            </p>
          )}
          {schedules.data && items.length === 0 && <EmptyText>이 달에 편성된 회차가 없습니다.</EmptyText>}
          <ScheduleCalendar month={month} items={items} today={today} linkToLog={can('S17', 'R')} />
        </div>
      ) : (
        <div className={schedules.status === 'loading' && schedules.data ? 'panel is-refreshing' : 'panel'}>
          {!schedules.data && schedules.status === 'loading' ? (
            <p className="muted">불러오는 중…</p>
          ) : items.length === 0 ? (
            <EmptyText>조건에 맞는 회차가 없습니다.</EmptyText>
          ) : (
            <table>
              <thead>
                <tr>
                  {!courseId && <th>과정</th>}
                  <th>회차</th>
                  <th>교육일</th>
                  <th>시간</th>
                  <th>강사</th>
                  <th>내용</th>
                  <th>상태</th>
                  {canUpdate && <th />}
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.scheduleId}>
                    {!courseId && <td>{s.courseName}</td>}
                    <td>
                      {/* 회차 클릭 → 해당 회차 운영일지(S17). 휴강 회차는 작성 대상이 아니다 */}
                      {can('S17', 'R') && s.status !== 'CANCELLED' ? <Link to={`/operation-logs?course_id=${s.courseId}&schedule_id=${s.scheduleId}`}>{s.roundNo}회차</Link> : `${s.roundNo}회차`}
                    </td>
                    <td>{s.classDate}</td>
                    <td>
                      {formatTime(s.startTime)}~{formatTime(s.endTime)}
                    </td>
                    <td>{s.instructorName}</td>
                    <td className="wrap">{s.content ?? ''}</td>
                    <td>
                      <ScheduleStatusBadge status={s.displayStatus} />
                    </td>
                    {canUpdate && (
                      <td>
                        {s.status !== 'CANCELLED' && (
                          <div className="row-actions">
                            <button type="button" onClick={() => setDialog({ kind: 'edit', schedule: s })} aria-label={`${s.courseName} ${s.roundNo}회차 수정`}>
                              수정
                            </button>
                            <button type="button" onClick={() => setDialog({ kind: 'reassign', schedule: s })} aria-label={`${s.courseName} ${s.roundNo}회차 강사 재배정`}>
                              강사 재배정
                            </button>
                            <button type="button" onClick={() => setDialog({ kind: 'cancel', schedule: s })} aria-label={`${s.courseName} ${s.roundNo}회차 휴강 처리`}>
                              휴강
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {view === 'list' && schedules.data && schedules.data.total > 0 && (
        <Pagination page={schedules.data.page} size={schedules.data.size} total={schedules.data.total} onChange={(p) => set({ page: String(p) })} />
      )}

      {dialog?.kind === 'create' && courseData && <ScheduleCreateDialog course={courseData} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'edit' && <ScheduleEditDialog schedule={dialog.schedule} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'cancel' && <CancelClassDialog schedule={dialog.schedule} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'reassign' && <ReassignDialog schedule={dialog.schedule} onClose={() => setDialog(null)} onSaved={saved} />}
    </section>
  )
}
