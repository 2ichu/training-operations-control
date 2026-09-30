import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { AttendanceBatchResult, RosterItem, ScheduleListItem } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { AttendanceBadge } from '../../components/StatusBadge'
import { formatTime, formatTimeOn, kstIso, todayKst } from '../../format'
import { ATTENDANCE_STATUS_LABELS, label, SOURCE_TYPE_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { AttendanceCorrectDialog } from './AttendanceCorrectDialog'

type BatchAction = 'check-in' | 'check-out' | 'absence'

// 훈련장 출석 전광판 카드(상태별 인원). 색은 의미만: 출석=초록, 지각·조퇴=주황, 결석=빨강, 인정결석=파랑, 미출결=회색
const BOARD = [
  { status: 'PRESENT', tone: 'ok' },
  { status: 'LATE', tone: 'warn' },
  { status: 'EARLY_LEAVE', tone: 'warn' },
  { status: 'ABSENT', tone: 'bad' },
  { status: 'EXCUSED', tone: 'info' },
  { status: 'NOT_CHECKED', tone: 'none' },
] as const

function countStatuses(items: RosterItem[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of items) if (r.displayStatus) out[r.displayStatus] = (out[r.displayStatus] ?? 0) + 1
  return out
}

// S07 일일 출결(system-design 7-A, C1): 조회일·회차를 고르면 확정 훈련생 전체를 출결과 LEFT JOIN 한 명단을 보여준다.
// 기록이 없는 훈련생은 저장되지 않은 계산값 "미출결"이고, 여기서 최초 입실 확인·결석 확정(INSERT)을 한다.
// 이미 있는 기록의 값 변경은 S09(수정 모달)로만 한다. 강사는 본인 회차의 입실·퇴실 확인만(결석 확정은 운영담당자 — S07:A).
export function DailyAttendancePage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const date = get('date') || todayKst()
  const courseId = get('course_id')
  const courses = useCourseOptions()
  const schedules = useApi(
    (signal) => api.getAll<ScheduleListItem>('/schedules', { from: date, to: date, course_id: courseId }, signal).then((r) => r.items),
    `${date}:${courseId}`,
  )
  const scheduleList = schedules.data ?? []
  const selected = scheduleList.find((s) => String(s.scheduleId) === get('schedule_id')) ?? scheduleList[0]

  return (
    <section className="page">
      <div className="page-header">
        <h1>일일 출결</h1>
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          조회일
          <input type="date" value={date} onChange={(e) => set({ date: e.target.value, schedule_id: undefined })} />
        </label>
        <label>
          과정
          <select value={courseId} onChange={(e) => set({ course_id: e.target.value, schedule_id: undefined })}>
            <option value="">전체</option>
            {courses.data?.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          회차
          <select value={selected ? String(selected.scheduleId) : ''} onChange={(e) => set({ schedule_id: e.target.value })} disabled={scheduleList.length === 0}>
            {scheduleList.length === 0 && <option value="">회차 없음</option>}
            {scheduleList.map((s) => (
              <option key={s.scheduleId} value={s.scheduleId}>
                {s.courseName} {s.roundNo}회차 {formatTime(s.startTime)}~{formatTime(s.endTime)}
                {s.status === 'CANCELLED' ? ' (휴강)' : ''}
              </option>
            ))}
          </select>
        </label>
      </form>

      {schedules.status === 'error' && <ErrorText error={schedules.error} onRetry={schedules.reload} />}
      {schedules.data && !selected && <EmptyText>{date} 에 예정된 훈련이 없습니다.</EmptyText>}
      {selected &&
        (selected.status === 'CANCELLED' ? (
          <p className="notice">휴강 처리된 회차입니다. 출결을 기록하지 않습니다.</p>
        ) : (
          <Roster key={selected.scheduleId} schedule={selected} canCheckIn={can('S07', 'C')} canCheckOut={can('S07', 'U')} canAbsence={can('S07', 'A')} />
        ))}
    </section>
  )
}

function Roster({ schedule, canCheckIn, canCheckOut, canAbsence }: { schedule: ScheduleListItem; canCheckIn: boolean; canCheckOut: boolean; canAbsence: boolean }) {
  const { can } = useAuth()
  const [statusFilter, setStatusFilter] = useState('')
  // 요약 카드(출석·지각·결석…)는 항상 전체 명단 기준이라 상태 필터는 받은 뒤 화면에서 건다
  const roster = useApi((signal) => api.get<{ items: RosterItem[] }>(`/schedules/${schedule.scheduleId}/attendance-roster`, undefined, signal).then((r) => r.items), String(schedule.scheduleId))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [time, setTime] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<RosterItem | null>(null)
  const all = roster.data ?? []
  const items = statusFilter ? all.filter((r) => r.displayStatus === statusFilter) : all
  const counts = countStatuses(all)
  const picked = items.filter((r) => selected.has(r.traineeId))
  const notChecked = picked.filter((r) => r.attendanceId === null)
  // 퇴실 확인: 기록이 있고 퇴실 시각이 비어 있으며 공식 출결이 아닌 행(공식 값은 읽기전용 — S07 예외 상황)
  const checkOutTargets = picked.filter((r) => r.attendanceId !== null && r.checkOutTime === null && r.sourceType !== 'OFFICIAL')
  // 출처가 모두 같으면(예: 전원 공식) 정보가 없는 열이라 뺀다
  const showSource = new Set(all.map((r) => r.sourceType ?? '')).size > 1
  const selectable = canCheckIn || canCheckOut || canAbsence

  // 1-Click 일괄: 기록이 없는 훈련생 전원을 한 번에 입실 확인(출석) 처리한다. 이후 결석·지각 등 예외만 개별 수정한다.
  const unchecked = all.filter((r) => r.attendanceId === null)
  const [confirmAll, setConfirmAll] = useState(false)

  const run = async (action: BatchAction, targets: RosterItem[] = notChecked) => {
    setBusy(true)
    setMessage(null)
    const at = time ? kstIso(`${schedule.classDate}T${time}`) : undefined
    try {
      let result: AttendanceBatchResult
      if (action === 'check-in') result = await api.post(`/schedules/${schedule.scheduleId}/attendance/check-in`, { trainee_ids: targets.map((r) => r.traineeId), ...(at ? { check_in_time: at } : {}) })
      else if (action === 'absence') result = await api.post(`/schedules/${schedule.scheduleId}/attendance/confirm-absence`, { trainee_ids: targets.map((r) => r.traineeId) })
      else result = await api.post('/attendance/check-out', { attendance_ids: checkOutTargets.map((r) => r.attendanceId), ...(at ? { check_out_time: at } : {}) })
      const done = (result.created ?? result.updated ?? []).length
      const skipped = result.alreadyExists.length + (result.notEligible?.length ?? 0) + (result.notFound?.length ?? 0)
      const verb = action === 'check-in' ? '입실 확인' : action === 'absence' ? '결석 확정' : '퇴실 확인'
      // UNIQUE(trainee_id, schedule_id): 그 사이 다른 사람이 먼저 처리한 건은 건너뛰고 알려 준다(S07 예외 상황)
      setMessage({ kind: 'ok', text: `${verb} ${done}건 처리했습니다.${skipped > 0 ? ` 이미 처리됐거나 대상이 아닌 ${skipped}건은 건너뛰었습니다.` : ''}` })
      setSelected(new Set())
      roster.reload()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : '처리하지 못했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {roster.data && (
        <ul className="board" aria-label="출결 현황 요약">
          {BOARD.map((b) => (
            <li key={b.status} className={`board-card board-${b.tone}`}>
              <button type="button" aria-pressed={statusFilter === b.status} onClick={() => setStatusFilter(statusFilter === b.status ? '' : b.status)}>
                <span className="board-label">{label(ATTENDANCE_STATUS_LABELS, b.status)}</span>{' '}
                <span className="board-value">{counts[b.status] ?? 0}명</span>
              </button>
            </li>
          ))}
          <li className="board-total">전체 {all.length}명</li>
        </ul>
      )}
      <div className="filters">
        <label>
          출결상태
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">전체</option>
            {Object.entries(ATTENDANCE_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
        {selectable && (
          <label>
            처리 시각(비우면 현재)
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        )}
      </div>
      {(canCheckIn || canCheckOut) && (
        <p className="hint">지각·조퇴는 처리 시각으로 자동 판정됩니다. 지난 회차를 나중에 입력할 때는 실제 입실·퇴실 시각을 넣어 주세요(비우면 현재 시각).</p>
      )}

      {selectable && (
        <div className="toolbar">
          {canCheckIn && (
            <button type="button" onClick={() => void run('check-in')} disabled={busy || notChecked.length === 0}>
              입실 확인 ({notChecked.length})
            </button>
          )}
          {canCheckOut && (
            <button type="button" onClick={() => void run('check-out')} disabled={busy || checkOutTargets.length === 0}>
              퇴실 확인 ({checkOutTargets.length})
            </button>
          )}
          {canCheckIn && (
            <button type="button" className="button-primary" onClick={() => setConfirmAll(true)} disabled={busy || unchecked.length === 0}>
              미입력 전체 출석 처리 ({unchecked.length})
            </button>
          )}
          {canAbsence && (
            <button type="button" onClick={() => void run('absence')} disabled={busy || notChecked.length === 0}>
              결석 확정 ({notChecked.length})
            </button>
          )}
        </div>
      )}
      {message && (
        <p className={message.kind === 'ok' ? 'notice' : 'form-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}

      {roster.status === 'error' && <ErrorText error={roster.error} onRetry={roster.reload} />}
      <div className={roster.status === 'loading' && roster.data ? 'panel is-refreshing' : 'panel'}>
        {!roster.data && roster.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>{statusFilter ? '조건에 맞는 훈련생이 없습니다.' : '이 과정에 확정된 훈련생이 없습니다.'}</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                {selectable && (
                  <th>
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={items.every((r) => selected.has(r.traineeId))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(items.map((r) => r.traineeId)) : new Set())}
                    />
                  </th>
                )}
                <th>훈련생명</th>
                <th>입실</th>
                <th>퇴실</th>
                <th>출결상태</th>
                {showSource && <th>출처</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.traineeId}>
                  {selectable && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${r.name} 선택`}
                        checked={selected.has(r.traineeId)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(r.traineeId)) next.delete(r.traineeId)
                            else next.add(r.traineeId)
                            return next
                          })
                        }
                      />
                    </td>
                  )}
                  <td>{can('S05', 'R') ? <Link to={`/trainees/${r.traineeId}?course_id=${schedule.courseId}`}>{r.name}</Link> : r.name}</td>
                  <td>{formatTimeOn(r.checkInTime, schedule.classDate)}</td>
                  <td>{formatTimeOn(r.checkOutTime, schedule.classDate)}</td>
                  <td>
                    <AttendanceBadge status={r.displayStatus} />
                  </td>
                  {showSource && <td>{r.sourceType ? label(SOURCE_TYPE_LABELS, r.sourceType) : ''}</td>}
                  <td>
                    {r.attendanceId !== null && can('S09', 'R') && (
                      <button type="button" className="button-link" onClick={() => setEditing(r)}>
                        {can('S09', 'U') ? '수정' : '상세'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmAll && (
        <Modal title="전체 출석 처리" onClose={() => setConfirmAll(false)}>
          <p>
            아직 출결이 기록되지 않은 {unchecked.length}명을 모두 입실 확인(출석) 처리합니다. 처리 시각은 {time ? `${time}` : '현재 시각'}이며, 지각·조퇴는 시각으로 자동 판정됩니다.
            결석·지각 등 예외는 처리 후 개별로 수정하세요.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={() => {
                setConfirmAll(false)
                void run('check-in', unchecked)
              }}
            >
              전체 출석 처리
            </button>
            <button type="button" onClick={() => setConfirmAll(false)}>
              취소
            </button>
          </div>
        </Modal>
      )}

      {editing && editing.attendanceId !== null && (
        <AttendanceCorrectDialog
          attendanceId={editing.attendanceId}
          traineeName={editing.name}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setMessage({ kind: 'ok', text: `${editing.name}의 출결을 수정했습니다.` })
            roster.reload()
          }}
        />
      )}
    </>
  )
}
