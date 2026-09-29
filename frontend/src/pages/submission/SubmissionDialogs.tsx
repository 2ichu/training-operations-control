import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { SubmissionStatusRow } from '../../api/types'
import { Modal } from '../../components/Modal'
import { formatDateTime, kstIso } from '../../format'

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}

// 결과물 파일은 결과물 행을 만든(또는 버전을 올린) 뒤 첨부로 올린다(POST /attachments, entity_version = 현재 버전).
// 행 저장은 됐는데 파일 업로드만 실패하면 그 사실을 그대로 알려 재등록 없이 다시 올릴 수 있게 한다.
async function uploadFile(submissionId: number, file: File): Promise<string> {
  try {
    await api.upload('SUBMISSION', submissionId, file)
    return ''
  } catch (e) {
    return ` 다만 파일을 올리지 못했습니다(${e instanceof ApiError ? e.message : '오류'}). 결과물 상세에서 다시 올려 주세요.`
  }
}

// S19 결과물 등록(D-01: 담당자 등록). 원본 제출 일시(submitted_at)는 훈련생이 실제 낸 시점을 수기로 입력한다.
export function RegisterDialog({
  courseId,
  candidates,
  initialTraineeId,
  onClose,
  onSaved,
}: {
  courseId: string
  /** 확정 훈련생(한 사람이 제목을 달리해 여러 건을 낼 수 있어 제출 여부와 무관하게 전부) */
  candidates: { traineeId: number; traineeName: string }[]
  initialTraineeId?: number
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [traineeId, setTraineeId] = useState(initialTraineeId ? String(initialTraineeId) : '')
  const [title, setTitle] = useState('')
  const [submittedAt, setSubmittedAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!traineeId) return setError('훈련생을 선택해 주세요.')
    if (!title.trim()) return setError('제목을 입력해 주세요.')
    if (!submittedAt) return setError('원본 제출 일시를 입력해 주세요.')
    if (!file) return setError('파일을 선택해 주세요.')
    setBusy(true)
    setError(null)
    try {
      const created = await api.post<{ submissionId: number }>(`/courses/${courseId}/submissions`, { trainee_id: Number(traineeId), title: title.trim(), submitted_at: kstIso(submittedAt) })
      onSaved(`결과물을 등록했습니다.${await uploadFile(created.submissionId, file)}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '등록하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <Modal title="결과물 등록" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="stacked">
          훈련생
          <select value={traineeId} onChange={(e) => setTraineeId(e.target.value)}>
            <option value="">선택</option>
            {candidates.map((c) => (
              <option key={c.traineeId} value={c.traineeId}>
                {c.traineeName}
              </option>
            ))}
          </select>
        </label>
        <label className="stacked">
          제목
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label className="stacked">
          원본 제출 일시(훈련생이 실제 제출한 시각)
          <input type="datetime-local" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
        </label>
        <label className="stacked">
          파일(20MB 이하)
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <p className="hint">같은 훈련생·같은 제목의 결과물이 이미 있으면 등록되지 않습니다 — 목록의 재등록(버전 증가)을 이용해 주세요.</p>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '등록 중…' : '등록'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// S19 재등록: 같은 결과물의 버전을 올리고 검토 상태를 대기로 되돌린 뒤 새 파일을 그 버전으로 올린다(이전 버전 파일·검토이력은 보존).
export function ReRegisterDialog({ row, onClose, onSaved }: { row: SubmissionStatusRow; onClose: () => void; onSaved: (message: string) => void }) {
  const [submittedAt, setSubmittedAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!submittedAt) return setError('원본 제출 일시를 입력해 주세요.')
    if (!file) return setError('새 파일을 선택해 주세요.')
    setBusy(true)
    setError(null)
    try {
      const updated = await api.post<{ version: number }>(`/submissions/${row.submissionId}/re-register`, { submitted_at: kstIso(submittedAt) })
      onSaved(`v${updated.version}로 재등록했습니다.${await uploadFile(row.submissionId!, file)}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '재등록하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <Modal title="결과물 재등록" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>
          {row.traineeName} · {row.title} (현재 v{row.version}, 제출 {formatDateTime(row.submittedAt)})
        </p>
        <p className="hint">재등록하면 버전이 올라가고 검토 상태는 대기로 돌아갑니다. 이전 버전의 파일과 검토이력은 남습니다.</p>
        <label className="stacked">
          원본 제출 일시(재제출 시각)
          <input type="datetime-local" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
        </label>
        <label className="stacked">
          새 파일(20MB 이하)
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '저장 중…' : '재등록'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}
