import { type FormEvent, useState } from 'react'
import { ApiError } from '../../api/client'
import { INSTRUCTOR_STATUS_LABELS } from '../../labels'

export interface InstructorFormInitial {
  name: string
  /** 마스킹된 현재 값(수정 모드 안내용) */
  contact: string | null
  status: string
}

// S12 강사 등록/수정 폼. 서버는 연락처를 마스킹해서만 주므로(훈련생과 같은 기준) 수정 모드에서는 기존 값을 채우지 않고
// 바꿀 때만 새로 입력받는다. 수정은 사유가 필수이며 instructor_change_log 에 남는다.
export function InstructorForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit'
  initial?: InstructorFormInitial
  onSubmit: (body: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState(initial?.status ?? 'ACTIVE')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('성명을 입력해 주세요.')
    const body: Record<string, unknown> = {}
    if (mode === 'create') {
      body.name = name.trim()
      if (contact.trim()) body.contact = contact.trim()
      body.status = status
    } else {
      if (name.trim() !== initial?.name) body.name = name.trim()
      if (contact.trim()) body.contact = contact.trim()
      if (status !== initial?.status) body.status = status
      if (Object.keys(body).length === 0) return setError('변경한 내용이 없습니다.')
      if (!reason.trim()) return setError('수정 사유를 입력해 주세요.')
      body.reason = reason.trim()
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(body)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <form className="panel course-form" onSubmit={submit} noValidate aria-label={mode === 'create' ? '강사 등록' : '강사 수정'}>
      <div className="form-row">
        <div className="field">
          <label htmlFor="instructor-name">성명(필수)</label>
          <input id="instructor-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </div>
        <div className="field">
          <label htmlFor="instructor-contact">{mode === 'create' ? '연락처' : '연락처(바꿀 때만 입력)'}</label>
          <input id="instructor-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={50} />
          {mode === 'edit' && <span className="hint">현재: {initial?.contact ?? '없음'}</span>}
        </div>
        <div className="field">
          <label htmlFor="instructor-status">상태</label>
          <select id="instructor-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(INSTRUCTOR_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </div>
      </div>
      {mode === 'edit' && initial?.status === 'ACTIVE' && status === 'INACTIVE' && (
        <p className="hint">비활동으로 바꿔도 기존 배정·회차는 그대로 남습니다. 진행 중인 과정의 배정이 있으면 저장 후 대체 배정이 필요합니다.</p>
      )}
      {mode === 'edit' && (
        <div className="field">
          <label htmlFor="instructor-reason">수정 사유(필수)</label>
          <input id="instructor-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
        <button type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  )
}
