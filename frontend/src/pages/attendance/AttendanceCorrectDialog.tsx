import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { AttendanceRecord } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { ErrorText } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { AttendanceBadge } from '../../components/StatusBadge'
import { formatDateTime, kstIso, toKstInput } from '../../format'
import { ATTENDANCE_STATUS_LABELS, label, SOURCE_TYPE_LABELS } from '../../labels'

// 저장 가능한 출결 상태(baseline 3-3 — 미출결은 계산값이라 선택 불가)
const STATUSES = ['PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED']

// S09 출결 수정(모달, system-design 7-A): 이미 존재하는 출결 건만 사유와 함께 정정한다(최초 입실·결석 확정은 S07, C1).
// 동시 수정은 last_modified_at 낙관적 잠금으로 막고(V5), 충돌 시 최신 값을 다시 불러온다. 정정 권한(S09:U)이 없으면 조회만 한다.
export function AttendanceCorrectDialog({ attendanceId, traineeName, onClose, onSaved }: { attendanceId: number; traineeName: string; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth()
  const canCorrect = can('S09', 'U')
  const record = useApi((signal) => api.get<AttendanceRecord>(`/attendance/${attendanceId}`, undefined, signal), String(attendanceId))
  const data = record.data

  return (
    <Modal title={canCorrect ? '출결 수정' : '출결 상세'} onClose={onClose}>
      <p>{traineeName}</p>
      {record.status === 'error' && <ErrorText error={record.error} onRetry={record.reload} />}
      {!data && record.status === 'loading' && <p className="muted">불러오는 중…</p>}
      {data && (
        <>
          <dl className="summary-grid">
            <div>
              <dt>현재 상태</dt>
              <dd>
                <AttendanceBadge status={data.attendanceStatus} />
              </dd>
            </div>
            <div>
              <dt>입실</dt>
              <dd>{formatDateTime(data.checkInTime)}</dd>
            </div>
            <div>
              <dt>퇴실</dt>
              <dd>{formatDateTime(data.checkOutTime)}</dd>
            </div>
            <div>
              <dt>출처</dt>
              <dd>{label(SOURCE_TYPE_LABELS, data.sourceType)}</dd>
            </div>
          </dl>
          {canCorrect ? (
            // key: 다시 불러오면 폼을 최신 값으로 초기화한다
            <CorrectForm key={data.lastModifiedAt ?? 'initial'} record={data} onClose={onClose} onSaved={onSaved} onStale={record.reload} />
          ) : (
            <div className="form-actions">
              <button type="button" onClick={onClose}>
                닫기
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function CorrectForm({ record, onClose, onSaved, onStale }: { record: AttendanceRecord; onClose: () => void; onSaved: () => void; onStale: () => void }) {
  const [status, setStatus] = useState(record.attendanceStatus)
  const [checkIn, setCheckIn] = useState(toKstInput(record.checkInTime))
  const [checkOut, setCheckOut] = useState(toKstInput(record.checkOutTime))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const body: Record<string, unknown> = {}
    if (status !== record.attendanceStatus) body.attendance_status = status
    if (checkIn !== toKstInput(record.checkInTime)) body.check_in_time = checkIn ? kstIso(checkIn) : null
    if (checkOut !== toKstInput(record.checkOutTime)) body.check_out_time = checkOut ? kstIso(checkOut) : null
    if (Object.keys(body).length === 0) return setError('변경한 내용이 없습니다.')
    if (!reason.trim()) return setError('수정 사유를 입력해 주세요.')
    setSubmitting(true)
    setError(null)
    try {
      await api.post(`/attendance/${record.attendanceId}/correct`, { ...body, reason: reason.trim(), expected_last_modified_at: record.lastModifiedAt })
      onSaved()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_ATTENDANCE') {
        setError('다른 곳에서 먼저 수정했습니다. 최신 값을 다시 불러왔으니 확인 후 다시 저장해 주세요.')
        onStale()
      } else {
        setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="form-row">
        <label className="stacked">
          출결상태
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(ATTENDANCE_STATUS_LABELS, s)}
              </option>
            ))}
          </select>
        </label>
        <label className="stacked">
          입실
          <input type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </label>
        <label className="stacked">
          퇴실
          <input type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </label>
      </div>
      <label className="stacked">
        수정 사유(필수)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </label>
      {/* system-design S09: 반복 수정은 RULE_05·06 의 탐지 근거가 된다 */}
      <p className="hint">출결 수정은 이력으로 남으며, 같은 훈련생의 반복 수정은 확인 필요 사항으로 탐지될 수 있습니다.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? '저장 중…' : '저장'}
        </button>
        <button type="button" onClick={onClose}>
          취소
        </button>
      </div>
    </form>
  )
}
