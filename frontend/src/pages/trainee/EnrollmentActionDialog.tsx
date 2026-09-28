import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { EnrollmentListItem } from '../../api/types'
import { Modal } from '../../components/Modal'
import { ENROLLMENT_ACTIONS, type EnrollmentAction } from './enrollment-model'

export function EnrollmentActionDialog({
  enrollment,
  action,
  onClose,
  onDone,
}: {
  enrollment: Pick<EnrollmentListItem, 'enrollmentId' | 'name' | 'courseName'>
  action: EnrollmentAction
  onClose: () => void
  onDone: (message: string) => void
}) {
  const spec = ENROLLMENT_ACTIONS[action]
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (spec.required && !value) return setError('사유를 입력해 주세요.')
    setSubmitting(true)
    setError(null)
    try {
      await api.post(`/enrollments/${enrollment.enrollmentId}/${action}`, value ? { [spec.field]: value } : {})
      onDone(`${enrollment.name} — ${spec.label} 처리했습니다.`)
    } catch (e) {
      // 409 INVALID_STATE_TRANSITION: 다른 사용자가 먼저 처리함 → 목록을 새로 고치도록 안내
      setError(e instanceof ApiError ? (e.code === 'INVALID_STATE_TRANSITION' ? `${e.message} 목록을 새로 고쳐 주세요.` : e.message) : '처리하지 못했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={spec.label} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>
          {enrollment.name} · {enrollment.courseName}
        </p>
        {spec.note && <p className="muted">{spec.note}</p>}
        <label className="stacked">
          {spec.required ? '사유(필수)' : '사유(선택)'}
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={3} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={submitting}>
            {submitting ? '처리 중…' : spec.label}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}
