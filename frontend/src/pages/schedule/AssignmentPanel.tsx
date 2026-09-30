import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { AssignmentCancelResult, CourseDetail, InstructorListItem } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { formatDateTime } from '../../format'
import { ASSIGNMENT_STATUS_LABELS, label } from '../../labels'

type Assignment = CourseDetail['instructorAssignments'][number]

// S13 강사 배정(별도 메뉴 없이 훈련일정 화면에서 — system-design 3.3). 과정 전체 담당 또는 회차별 배정.
// 취소는 사유가 필수이며 instructor_change_log(ASSIGNMENT)에 남는다. 남은 예정 회차가 있으면 경고만 한다(P1-16).
export function AssignmentPanel({ course, locked, onChanged }: { course: CourseDetail; locked: boolean; onChanged: (message: string) => void }) {
  const { can } = useAuth()
  const canAdd = can('S13', 'C') && !locked
  const canCancel = can('S13', 'U') && !locked
  const [adding, setAdding] = useState(false)
  const [cancelling, setCancelling] = useState<Assignment | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const rows = course.instructorAssignments.filter((a) => showCancelled || a.status === 'ASSIGNED')

  return (
    <section className="panel" aria-label="강사 배정">
      <div className="panel-header">
        <h2>강사 배정</h2>
        <div className="toolbar">
          <label className="checkbox">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> 취소된 배정 포함
          </label>
          {canAdd && (
            <button type="button" onClick={() => setAdding(true)}>
              강사 배정 추가
            </button>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyText>배정된 강사가 없습니다.</EmptyText>
      ) : (
        <table>
          <thead>
            <tr>
              <th>강사</th>
              <th>범위</th>
              <th>상태</th>
              <th>배정일시</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.assignmentId} className={a.status === 'ASSIGNED' ? undefined : 'muted'}>
                <td>{a.instructorName}</td>
                <td>{a.roundNo === null ? '과정 전체' : `${a.roundNo}회차`}</td>
                <td>{label(ASSIGNMENT_STATUS_LABELS, a.status)}</td>
                <td>{formatDateTime(a.assignedAt)}</td>
                <td>
                  {canCancel && a.status === 'ASSIGNED' && (
                    <button type="button" className="button-link" onClick={() => setCancelling(a)}>
                      배정 취소
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding && (
        <AddAssignmentDialog
          course={course}
          onClose={() => setAdding(false)}
          onSaved={(message) => {
            setAdding(false)
            onChanged(message)
          }}
        />
      )}
      {cancelling && (
        <CancelAssignmentDialog
          assignment={cancelling}
          onClose={() => setCancelling(null)}
          onSaved={(message) => {
            setCancelling(null)
            onChanged(message)
          }}
        />
      )}
    </section>
  )
}

function AddAssignmentDialog({ course, onClose, onSaved }: { course: CourseDetail; onClose: () => void; onSaved: (message: string) => void }) {
  // 배정할 수 있는 강사 = 활동 강사(서버 INSTRUCTOR_INACTIVE 와 같은 기준)
  const instructors = useApi((signal) => api.getAll<InstructorListItem>('/instructors', { status: 'ACTIVE' }, signal).then((r) => r.items), 'active')
  const [instructorId, setInstructorId] = useState('')
  const [scope, setScope] = useState<'course' | 'round'>('course')
  const [roundNo, setRoundNo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!instructorId) return setError('강사를 선택해 주세요.')
    const round = Number(roundNo)
    if (scope === 'round' && (!Number.isInteger(round) || round < 1)) return setError('회차는 1 이상의 정수로 입력해 주세요.')
    setBusy(true)
    setError(null)
    try {
      await api.post(`/courses/${course.courseId}/instructor-assignments`, { instructor_id: Number(instructorId), ...(scope === 'round' ? { round_no: round } : {}) })
      const name = instructors.data?.find((i) => String(i.instructorId) === instructorId)?.name ?? '강사'
      onSaved(`${name}을(를) ${scope === 'round' ? `${round}회차` : '과정 전체'}에 배정했습니다.`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <Modal title="강사 배정 추가" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">{course.courseName}</p>
        <label className="stacked">
          강사(활동)
          <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
            <option value="">{instructors.data ? '선택' : '불러오는 중…'}</option>
            {instructors.data?.map((i) => (
              <option key={i.instructorId} value={i.instructorId}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="radio-group">
          <legend>범위</legend>
          <label>
            <input type="radio" name="scope" checked={scope === 'course'} onChange={() => setScope('course')} /> 과정 전체
          </label>
          <label>
            <input type="radio" name="scope" checked={scope === 'round'} onChange={() => setScope('round')} /> 특정 회차
          </label>
          {scope === 'round' && (
            <label>
              회차 <input type="number" min={1} value={roundNo} onChange={(e) => setRoundNo(e.target.value)} aria-label="배정 회차" />
            </label>
          )}
        </fieldset>
        <p className="hint">과정 전체 담당은 과정당 1명입니다. 회차별 배정은 같은 회차에 여러 강사를 둘 수 있습니다.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '저장 중…' : '배정'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CancelAssignmentDialog({ assignment, onClose, onSaved }: { assignment: Assignment; onClose: () => void; onSaved: (message: string) => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!reason.trim()) return setError('취소 사유를 입력해 주세요.')
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<AssignmentCancelResult>(`/instructor-assignments/${assignment.assignmentId}/cancel`, { reason: reason.trim() })
      const remaining = result.warnings?.remainingScheduledCount ?? 0
      onSaved(`${assignment.instructorName}의 배정을 취소했습니다.${remaining > 0 ? ` 이 강사가 맡은 예정 회차 ${remaining}건이 남아 있습니다 — 필요하면 강사 재배정을 해 주세요.` : ''}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '처리하지 못했습니다.')
      setBusy(false)
    }
  }
  return (
    <Modal title="배정 취소" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>
          {assignment.instructorName} · {assignment.roundNo === null ? '과정 전체' : `${assignment.roundNo}회차`} 배정을 취소합니다. 이미 편성된 회차의 강사는 바뀌지 않습니다.
        </p>
        <label className="stacked">
          취소 사유(필수)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '처리 중…' : '배정 취소'}
          </button>
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </form>
    </Modal>
  )
}
