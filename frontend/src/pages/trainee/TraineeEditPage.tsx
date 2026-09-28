import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { TraineeDetail } from '../../api/types'
import { useApi } from '../../api/useApi'
import { ErrorText } from '../../components/Feedback'
import { NotFoundPage } from '../PlaceholderPages'

// S04 인적정보 수정. 서버는 연락처·생년월일을 마스킹해서만 주므로(원문 열람 미도입, P1-08) 기존 값을 채워 두지 않고,
// 바꿀 항목만 새로 입력받는다. 사유는 필수이며 trainee_change_log 에 남는다(V6).
export function TraineeEditPage() {
  const { id } = useParams()
  const traineeId = Number(id)
  const navigate = useNavigate()
  const detail = useApi((signal) => api.get<TraineeDetail>(`/trainees/${traineeId}`, undefined, signal), String(traineeId))
  const [name, setName] = useState<string | null>(null)
  const [birthDate, setBirthDate] = useState('')
  const [contact, setContact] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!Number.isInteger(traineeId) || traineeId <= 0) return <NotFoundPage />
  if (detail.status === 'error' && detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />
  const trainee = detail.data
  const currentName = name ?? trainee?.name ?? ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!trainee) return
    const body: Record<string, unknown> = {}
    if (!currentName.trim()) return setError('성명은 비워 둘 수 없습니다.')
    if (currentName.trim() !== trainee.name) body.name = currentName.trim()
    if (birthDate) body.birth_date = birthDate
    if (contact.trim()) body.contact = contact.trim()
    if (Object.keys(body).length === 0) return setError('변경한 내용이 없습니다.')
    if (!reason.trim()) return setError('수정 사유를 입력해 주세요.')
    body.reason = reason.trim()
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/trainees/${traineeId}`, body)
      navigate(`/trainees/${traineeId}`, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>훈련생 정보 수정</h1>
        <Link to={`/trainees/${traineeId}`}>상세로</Link>
      </div>
      {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
      {!trainee && detail.status === 'loading' && <p className="muted">불러오는 중…</p>}
      {trainee && (
        <form className="panel course-form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="edit-name">성명</label>
            <input id="edit-name" value={currentName} onChange={(e) => setName(e.target.value)} maxLength={50} />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="edit-birth">생년월일(바꿀 때만 입력)</label>
              <input id="edit-birth" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
              <span className="hint">현재: {trainee.birthDate ?? '없음'}</span>
            </div>
            <div className="field">
              <label htmlFor="edit-contact">연락처(바꿀 때만 입력)</label>
              <input id="edit-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={50} />
              <span className="hint">현재: {trainee.contact ?? '없음'}</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="edit-reason">수정 사유(필수)</label>
            <input id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" onClick={() => navigate(`/trainees/${traineeId}`)}>
              취소
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
