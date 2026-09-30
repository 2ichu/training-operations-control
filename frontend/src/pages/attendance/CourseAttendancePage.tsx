import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { AttendanceMatrix } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { COMPLETION_THRESHOLD, completionRisk, monthsOf, monthTally, rateOf } from '../../attendance-metrics'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { AttendanceBadge } from '../../components/StatusBadge'
import { todayKst } from '../../format'
import { ATTENDANCE_SHORT_LABELS, ATTENDANCE_STATUS_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { AttendanceCorrectDialog } from './AttendanceCorrectDialog'

// S08 과정별 출결(system-design 7-A): 훈련생 × 회차 매트릭스. 기록 없는 셀은 계산값 "미출결"(C1), 휴강 회차는 제외.
// 셀 클릭: 기록이 있으면 S09 수정(권한 없으면 상세), 미출결이면 그 회차의 일일 출결(S07)로 이동해 입실·결석을 처리한다.
// 강사에게는 서버가 본인 회차 열만 준다. 출석률 = (출석·지각·조퇴·인정결석 일수 − 지각·조퇴 3회당 결석 1일) / 휴강 제외 전체 회차(미출결 포함).
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

      {data && data.schedules.length > 0 && data.items.length > 0 && <PeriodPanels data={data} />}

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

const pct = (rate: number | null) => (rate === null ? '-' : `${(rate * 100).toFixed(1)}%`)
const THRESHOLD_PCT = COMPLETION_THRESHOLD * 100

// 이수 위험군(진행 회차 기준 출석률 80% 미만)과 월별(단위기간) 출석률. 매트릭스에 이미 있는 값으로 계산하는 표시 전용이며 저장·판정을 바꾸지 않는다.
// 이수 확정은 S02 수료 후보에서 사람이 한다(D-05). 훈련장려금 수령 여부는 기관·사업 규정에 따르므로 80% 는 참고 표시다.
function PeriodPanels({ data }: { data: AttendanceMatrix }) {
  const today = todayKst()
  const months = monthsOf(data.schedules)
  const [month, setMonth] = useState(() => months.find((m) => m === today.slice(0, 7)) ?? months[months.length - 1])
  const risks = data.items
    .map((row) => ({ row, risk: completionRisk(row.cells, data.schedules, today) }))
    .filter((r): r is { row: (typeof data.items)[number]; risk: NonNullable<ReturnType<typeof completionRisk>> } => r.risk !== null)
    .sort((a, b) => a.risk.currentRate - b.risk.currentRate)

  return (
    <>
      <section className="panel" aria-labelledby="risk-title">
        <h2 id="risk-title">이수 위험군 (출석률 {THRESHOLD_PCT}% 미만)</h2>
        {risks.length === 0 ? (
          <EmptyText>진행된 회차 기준으로 이수 기준({THRESHOLD_PCT}%)에 미달한 훈련생이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>훈련생</th>
                <th className="num">현재 출석률</th>
                <th className="num">진행 회차</th>
                <th className="num">남은 회차</th>
                <th className="num">최대 가능 출석률</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {risks.map(({ row, risk }) => (
                <tr key={row.traineeId}>
                  <td>{row.name}</td>
                  <td className="num">{pct(risk.currentRate)}</td>
                  <td className="num">{risk.heldCount}회</td>
                  <td className="num">{risk.remainingCount}회</td>
                  <td className="num">{pct(risk.maxRate)}</td>
                  <td>
                    <span className={risk.level === 'IMPOSSIBLE' ? 'badge badge-action' : 'badge badge-attention'}>{risk.level === 'IMPOSSIBLE' ? '이수 곤란' : '이수 위험'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">지각·조퇴 3회는 결석 1일로 환산합니다. 이수 확정은 수료 후보(대상자 확인)에서 담당자가 합니다.</p>
      </section>

      <section className="panel" aria-labelledby="month-title">
        <h2 id="month-title">월별 출석률</h2>
        <div className="filters">
          <label>
            단위기간
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>훈련생</th>
              <th className="num">월 회차</th>
              <th className="num">월 출석률</th>
              <th>{THRESHOLD_PCT}% 기준(참고)</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => {
              const t = monthTally(row.cells, data.schedules, month)
              const rate = rateOf(t)
              return (
                <tr key={row.traineeId}>
                  <td>{row.name}</td>
                  <td className="num">{t.applicable}회</td>
                  <td className="num">{pct(rate)}</td>
                  <td>{rate === null ? '-' : rate >= COMPLETION_THRESHOLD ? <span className="badge badge-done">기준 충족</span> : <span className="badge badge-attention">기준 미달</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="hint">훈련장려금 수령 가능 여부는 기관·사업별 규정을 따릅니다. 여기의 {THRESHOLD_PCT}% 기준은 참고 표시입니다.</p>
      </section>
    </>
  )
}
