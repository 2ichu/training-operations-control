import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { OperationLogDetail, OperationLogRow } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { ErrorText } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { formatDateTime, formatTime } from '../../format'
import { Attachments } from './Attachments'

interface FormValues {
  content: string
  participantCount: string
  issueNote: string
}

// S17 회차별 운영일지 작성/조회(모달). 작성은 담당 강사(S17:C, 본인 회차), 수정은 작성 강사 또는 운영담당자 검수(S17:U).
// 첨부는 운영일지가 저장된 뒤에 추가한다(첨부의 부모 ID 가 필요). "특이사항으로 등록"은 S18 등록 폼으로 넘긴다.
export function OperationLogDialog({ courseId, row, onClose, onSaved }: { courseId: string; row: OperationLogRow; onClose: () => void; onSaved: () => void }) {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [logId, setLogId] = useState(row.operationLogId)
  const detail = useApi(
    (signal) => (logId ? api.get<OperationLogDetail>(`/schedules/${row.scheduleId}/operation-log`, undefined, signal) : Promise.resolve(null)),
    `${row.scheduleId}:${logId}`,
  )
  const [editing, setEditing] = useState(false)
  const log = detail.data
  const title = `${row.roundNo}회차 운영일지`
  const creating = !logId

  const toIssue = () =>
    navigate(`/course-issues?course_id=${courseId}`, { state: { register: { scheduleId: row.scheduleId, content: log?.issueNote ?? '' } } })

  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">
        {row.classDate} {formatTime(row.startTime)}~{formatTime(row.endTime)} · {row.instructorName}
      </p>
      {creating ? (
        can('S17', 'C') ? (
          <LogForm
            submitLabel="저장"
            initial={{ content: '', participantCount: '', issueNote: '' }}
            onCancel={onClose}
            onSubmit={async (values) => {
              const created = await api.post<{ operationLogId: number }>(`/schedules/${row.scheduleId}/operation-log`, {
                content: values.content.trim(),
                participant_count: Number(values.participantCount),
                ...(values.issueNote.trim() ? { issue_note: values.issueNote.trim() } : {}),
              })
              setLogId(created.operationLogId)
              onSaved()
            }}
          />
        ) : (
          <p className="empty-text">아직 작성되지 않았습니다.</p>
        )
      ) : (
        <>
          {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
          {!log && detail.status === 'loading' && <p className="muted">불러오는 중…</p>}
          {log && editing && (
            <LogForm
              submitLabel="저장"
              initial={{ content: log.content, participantCount: String(log.participantCount), issueNote: log.issueNote ?? '' }}
              onCancel={() => setEditing(false)}
              onSubmit={async (values) => {
                const body: Record<string, unknown> = {}
                if (values.content.trim() !== log.content) body.content = values.content.trim()
                if (Number(values.participantCount) !== log.participantCount) body.participant_count = Number(values.participantCount)
                if (values.issueNote.trim() !== (log.issueNote ?? '')) body.issue_note = values.issueNote.trim() || null
                if (Object.keys(body).length === 0) throw new Error('변경한 내용이 없습니다.')
                await api.patch(`/operation-logs/${log.operationLogId}`, body)
                setEditing(false)
                detail.reload()
                onSaved()
              }}
            />
          )}
          {log && !editing && (
            <>
              <dl className="summary-grid">
                <div>
                  <dt>참여인원</dt>
                  <dd>{log.participantCount}명</dd>
                </div>
                <div>
                  <dt>작성</dt>
                  <dd>
                    {log.authorName} · {formatDateTime(log.writtenAt)}
                  </dd>
                </div>
              </dl>
              <dl className="notes">
                <div>
                  <dt>교육내용</dt>
                  <dd>{log.content}</dd>
                </div>
                <div>
                  <dt>특이사항</dt>
                  <dd>{log.issueNote ?? '-'}</dd>
                </div>
              </dl>
              <Attachments items={log.attachments} entityType="OPERATION_LOG" entityId={log.operationLogId} canUpload={can('S17', 'C') || can('S17', 'U')} onUploaded={detail.reload} />
              <div className="form-actions">
                {can('S17', 'U') && (
                  <button type="button" onClick={() => setEditing(true)}>
                    수정
                  </button>
                )}
                {can('S18', 'C') && (
                  <button type="button" onClick={toIssue}>
                    특이사항으로 등록
                  </button>
                )}
                <button type="button" onClick={onClose}>
                  닫기
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}

function LogForm({ initial, submitLabel, onSubmit, onCancel }: { initial: FormValues; submitLabel: string; onSubmit: (values: FormValues) => Promise<void>; onCancel: () => void }) {
  const [values, setValues] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof FormValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!values.content.trim()) return setError('교육내용을 입력해 주세요.')
    const count = Number(values.participantCount)
    if (values.participantCount === '' || !Number.isInteger(count) || count < 0) return setError('참여인원을 0 이상의 정수로 입력해 주세요.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit(values)
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="stacked">
        교육내용(필수)
        <textarea value={values.content} onChange={set('content')} maxLength={4000} rows={4} />
      </label>
      <label className="stacked">
        참여인원(필수)
        <input type="number" min={0} value={values.participantCount} onChange={set('participantCount')} />
      </label>
      <label className="stacked">
        특이사항(선택)
        <textarea value={values.issueNote} onChange={set('issueNote')} maxLength={2000} rows={2} />
      </label>
      <p className="hint">운영일지는 교육 종료 후 제때 작성해야 합니다. 늦어지면 확인 필요 사항(회차 운영기록 지연)으로 탐지될 수 있습니다.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? '저장 중…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  )
}
