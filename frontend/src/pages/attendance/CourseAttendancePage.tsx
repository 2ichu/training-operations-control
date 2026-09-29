import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { AttendanceMatrix } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { AttendanceBadge } from '../../components/StatusBadge'
import { ATTENDANCE_SHORT_LABELS, ATTENDANCE_STATUS_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { AttendanceCorrectDialog } from './AttendanceCorrectDialog'

// S08 과정별 출결(system-design 7-A): 훈련생 × 회차 매트릭스. 기록 없는 셀은 계산값 "미출결"(C1), 휴강 회차는 제외.
// 셀 클릭: 기록이 있으면 S09 수정(권한 없으면 상세), 미출결이면 그 회차의 일일 출결(S07)로 이동해 입실·결석을 처리한다.
// 강사에게는 서버가 본인 회차 열만 준다. 출석률 = 가중 출석률(출석 1·지각 0.5·조퇴 0.5·인정결석 1·결석 0) / 휴강 제외 전체 회차(미출결 포함).
export function CourseAttendancePage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const courses = useCourseOptions()
  const query = { trainee_name: get('trainee_name'), status: get('status') }
  const matrix = useApi(
    (signal) => (courseId ? api.get<AttendanceMatrix>(`/courses/${courseId}/attendance-matrix`, query, signal) : Promise.resolve(null)),
    `${courseId}:${JSON.stringify(query)}`,
  )
  const [name, setName] = useState(get('trainee_name'))
  const [editing, setEditing] = useState<{ attendanceId: number; name: string } | null>(null)
  const data = matrix.data

  return (
    <section className="page">
      <div className="page-header">
        <h1>과정별 출결</h1>
      </div>
      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ trainee_name: name.trim() || undefined })
        }}
      >
        <label>
          과정(필수)
          <select value={courseId} onChange={(e) => set({ course_id: e.target.value })}>
            <option value="">선택</option>
            {courses.data?.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          훈련생명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <button type="submit">검색</button>
        <label>
          출결상태 포함
          <select value={get('status')} onChange={(e) => set({ status: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(ATTENDANCE_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </form>

      {!courseId && <EmptyText>과정을 선택해 주세요.</EmptyText>}
      {matrix.status === 'error' && <ErrorText error={matrix.error} onRetry={matrix.reload} />}
      {data && (
        <div className={matrix.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
          <p className="legend" aria-label="범례">
            {Object.entries(ATTENDANCE_SHORT_LABELS).map(([code, short]) => (
              <span key={code}>
                {short} = {label(ATTENDANCE_STATUS_LABELS, code)}
              </span>
            ))}
            <span>휴 = 휴강</span>
          </p>
          {data.schedules.length === 0 ? (
            <EmptyText>볼 수 있는 회차가 없습니다.</EmptyText>
          ) : data.items.length === 0 ? (
            <EmptyText>조건에 맞는 확정 훈련생이 없습니다.</EmptyText>
          ) : (
            <div className="matrix-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>훈련생</th>
                    {data.schedules.map((s) => (
                      <th key={s.scheduleId} className="round" scope="col">
                        {s.roundNo}회차
                        <br />
                        {s.classDate.slice(5)}
                      </th>
                    ))}
                    <th className="num">출석률</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.traineeId}>
                      <th scope="row">{can('S05', 'R') ? <Link to={`/trainees/${row.traineeId}?course_id=${courseId}`}>{row.name}</Link> : row.name}</th>
                      {row.cells.map((cell) => {
                        const schedule = data.schedules.find((s) => s.scheduleId === cell.scheduleId)!
                        const badge = <AttendanceBadge status={cell.displayStatus} short />
                        return (
                          <td key={cell.scheduleId} className="cell">
                            {cell.attendanceId !== null && can('S09', 'R') ? (
                              <button type="button" aria-label={`${row.name} ${schedule.roundNo}회차 ${label(ATTENDANCE_STATUS_LABELS, cell.displayStatus ?? '')}`} onClick={() => setEditing({ attendanceId: cell.attendanceId!, name: `${row.name} · ${schedule.roundNo}회차` })}>
                                {badge}
                              </button>
                            ) : cell.displayStatus === 'NOT_CHECKED' && can('S07', 'R') ? (
                              <Link to={`/attendance/daily?date=${schedule.classDate}&course_id=${courseId}&schedule_id=${schedule.scheduleId}`} aria-label={`${row.name} ${schedule.roundNo}회차 미출결 — 일일 출결에서 처리`}>
                                {badge}
                              </Link>
                            ) : (
                              badge
                            )}
                          </td>
                        )
                      })}
                      <td className="num">{row.attendanceRate === null ? '-' : `${(row.attendanceRate * 100).toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {editing && (
        <AttendanceCorrectDialog
          attendanceId={editing.attendanceId}
          traineeName={editing.name}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            matrix.reload()
          }}
        />
      )}
    </section>
  )
}
