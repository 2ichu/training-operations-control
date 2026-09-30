import { type FormEvent, useEffect, useState } from 'react'
import { ApiError, api, excuseEvidenceUrl } from '../../api/client'
import type { ExcuseEvidence, ExcuseRequestDetail, ExcuseRequestSummary, Paged, RosterItem, ScheduleListItem } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Modal } from '../../components/Modal'
import { Pagination } from '../../components/Pagination'
import { AttendanceBadge, ExcuseStatusBadge } from '../../components/StatusBadge'
import { formatBytes, formatDateTime } from '../../format'
import { EXCUSE_REASON_LABELS, EXCUSE_STATUS_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 20

// S30 공결(사유결석) 신청·승인. 왼쪽 신청 목록 + 오른쪽 증빙 미리보기·승인/반려(Split View)로 스크롤 없이 검토한다.
// 승인하면 서버가 해당 회차 출결을 "인정결석"으로 바꾸고(정정 이력 기록), 반려는 사유가 필수다. 증빙 없는 승인은 서버가 거부한다.
export function ExcuseRequestPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courses = useCourseOptions()
  const status = get('status') || 'PENDING'
  const page = Number(get('page')) || 1
  const query = { status: status === 'ALL' ? '' : status, course_id: get('course_id'), trainee_name: get('trainee_name'), page, size: PAGE_SIZE }
  const list = useApi((signal) => api.get<Paged<ExcuseRequestSummary>>('/excuse-requests', query, signal), JSON.stringify(query))
  const items = list.data?.items ?? []
  const selectedId = Number(get('id')) || items[0]?.requestId || null
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState(get('trainee_name'))

  return (
    <section className="page">
      <div className="page-header">
        <h1>공결 신청·승인</h1>
        {can('S30', 'C') && (
          <button type="button" className="button-primary" onClick={() => setCreating(true)}>
            공결 신청 등록
          </button>
        )}
      </div>
      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ trainee_name: name.trim() || undefined, id: undefined })
        }}
      >
        <label>
          처리 상태
          <select value={status} onChange={(e) => set({ status: e.target.value === 'PENDING' ? undefined : e.target.value, id: undefined })}>
            <option value="PENDING">{EXCUSE_STATUS_LABELS.PENDING}</option>
            <option value="APPROVED">{EXCUSE_STATUS_LABELS.APPROVED}</option>
            <option value="REJECTED">{EXCUSE_STATUS_LABELS.REJECTED}</option>
            <option value="ALL">전체</option>
          </select>
        </label>
        <label>
          과정
          <select value={get('course_id')} onChange={(e) => set({ course_id: e.target.value, id: undefined })}>
            <option value="">전체</option>
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
      </form>

      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className="split">
        <div className={list.status === 'loading' && list.data ? 'panel split-list is-refreshing' : 'panel split-list'}>
          <h2>신청 목록</h2>
          {!list.data && list.status === 'loading' ? (
            <Loading />
          ) : items.length === 0 ? (
            <EmptyText>{status === 'PENDING' ? '승인 대기 중인 공결 신청이 없습니다.' : '조건에 맞는 공결 신청이 없습니다.'}</EmptyText>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>훈련생</th>
                  <th>일자·회차</th>
                  <th>사유</th>
                  <th>증빙</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr
                    key={r.requestId}
                    className={r.requestId === selectedId ? 'clickable selected' : 'clickable'}
                    tabIndex={0}
                    aria-selected={r.requestId === selectedId}
                    onClick={() => set({ id: String(r.requestId) }, { keepPage: true })}
                    onKeyDown={(e) => e.key === 'Enter' && set({ id: String(r.requestId) }, { keepPage: true })}
                  >
                    <td>{r.traineeName}</td>
                    <td>
                      {r.classDate} · {r.roundNo}회차
                    </td>
                    <td>{label(EXCUSE_REASON_LABELS, r.reasonType).split('(')[0]}</td>
                    <td className="num">{r.evidenceCount}건</td>
                    <td>
                      <ExcuseStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {list.data && list.data.total > PAGE_SIZE && <Pagination page={page} size={PAGE_SIZE} total={list.data.total} onChange={(p) => set({ page: String(p) }, { keepPage: true })} />}
        </div>

        <div className="panel split-detail" aria-label="신청 상세">
          {selectedId ? <ExcuseDetail key={selectedId} requestId={selectedId} onChanged={list.reload} /> : <EmptyText>왼쪽 목록에서 신청을 선택하면 증빙서류와 처리 화면이 보입니다.</EmptyText>}
        </div>
      </div>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            set({ status: undefined, id: String(id) })
            list.reload()
          }}
        />
      )}
    </section>
  )
}

function ExcuseDetail({ requestId, onChanged }: { requestId: number; onChanged: () => void }) {
  const { can } = useAuth()
  const detail = useApi((signal) => api.get<ExcuseRequestDetail>(`/excuse-requests/${requestId}`, undefined, signal), String(requestId))
  const [evidenceId, setEvidenceId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const data = detail.data
  const current = data?.evidence.find((e) => e.evidenceId === evidenceId) ?? data?.evidence[0]

  const decide = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !note.trim()) {
      setMessage({ kind: 'error', text: '반려 사유를 입력해 주세요.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await api.post(`/excuse-requests/${requestId}/${action}`, { decision_note: note.trim() || undefined })
      setMessage({ kind: 'ok', text: action === 'approve' ? '승인했습니다. 해당 회차 출결이 인정결석으로 바뀌었습니다.' : '반려했습니다.' })
      setNote('')
      detail.reload()
      onChanged()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : '처리하지 못했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setMessage(null)
    try {
      const form = new FormData()
      form.append('file', file)
      await api.postForm(`/excuse-requests/${requestId}/evidence`, form)
      setMessage({ kind: 'ok', text: '증빙서류를 추가했습니다.' })
      detail.reload()
      onChanged()
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : '올리지 못했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  if (detail.status === 'error' && !data) return <ErrorText error={detail.error} onRetry={detail.reload} />
  if (!data) return <Loading />
  const pending = data.status === 'PENDING'

  return (
    <div className="excuse-detail">
      <h2>
        {data.traineeName} · {data.classDate} {data.roundNo}회차
      </h2>
      <dl className="summary-grid">
        <div>
          <dt>과정</dt>
          <dd>{data.courseName}</dd>
        </div>
        <div>
          <dt>사유</dt>
          <dd>{label(EXCUSE_REASON_LABELS, data.reasonType)}</dd>
        </div>
        <div>
          <dt>현재 출결</dt>
          <dd>{data.currentAttendanceStatus ? <AttendanceBadge status={data.currentAttendanceStatus} /> : <AttendanceBadge status="NOT_CHECKED" />}</dd>
        </div>
        <div>
          <dt>신청</dt>
          <dd>
            {formatDateTime(data.requestedAt)} · {data.requestedByName}
          </dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd>
            <ExcuseStatusBadge status={data.status} />
          </dd>
        </div>
        {data.reasonNote && (
          <div className="wide">
            <dt>신청 내용</dt>
            <dd className="wrap">{data.reasonNote}</dd>
          </div>
        )}
      </dl>

      <h3>증빙서류</h3>
      {data.evidence.length === 0 ? (
        <p className="empty-text left">첨부된 증빙서류가 없습니다. 증빙이 없으면 승인할 수 없습니다.</p>
      ) : (
        <>
          <div className="evidence-tabs" role="tablist" aria-label="증빙서류">
            {data.evidence.map((e) => (
              <button key={e.evidenceId} type="button" role="tab" aria-selected={current?.evidenceId === e.evidenceId} className={current?.evidenceId === e.evidenceId ? 'tab active' : 'tab'} onClick={() => setEvidenceId(e.evidenceId)}>
                {e.fileName} ({formatBytes(e.fileSize)})
              </button>
            ))}
          </div>
          {current && <EvidencePreview requestId={requestId} evidence={current} />}
        </>
      )}
      {pending && can('S30', 'C') && (
        <label className="file-add">
          증빙 추가(PDF·PNG·JPG·WEBP, 10MB 이하)
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      )}

      {message && (
        <p className={message.kind === 'ok' ? 'notice' : 'form-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      {pending && can('S30', 'U') ? (
        <div className="decision">
          <label>
            처리 메모(반려 시 필수)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
          </label>
          <div className="form-actions">
            <button type="button" className="button-primary" disabled={busy || data.evidence.length === 0} onClick={() => void decide('approve')}>
              승인
            </button>
            <button type="button" disabled={busy} onClick={() => void decide('reject')}>
              반려
            </button>
          </div>
        </div>
      ) : (
        !pending && (
          <p className="hint">
            {formatDateTime(data.decidedAt)} · {data.decidedByName} 처리{data.decisionNote ? ` — ${data.decisionNote}` : ''}
          </p>
        )
      )}
    </div>
  )
}

// 증빙 미리보기: 세션 쿠키로 받아 blob 으로 만들어 보여 준다(파일은 서버가 MIME 을 검증해 내려준다)
function EvidencePreview({ requestId, evidence }: { requestId: number; evidence: ExcuseEvidence }) {
  const [state, setState] = useState<{ key: string; url?: string; type?: string; failed?: boolean } | null>(null)
  const key = `${requestId}:${evidence.evidenceId}`
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    void fetch(excuseEvidenceUrl(requestId, evidence.evidenceId), { credentials: 'same-origin', signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        setState({ key, url: objectUrl, type: blob.type })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, failed: true })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [requestId, evidence.evidenceId, key])

  if (!state || state.key !== key) return <Loading />
  if (state.failed || !state.url) return <p className="form-error">증빙 파일을 불러오지 못했습니다.</p>
  return (
    <div className="preview">
      {state.type?.startsWith('image/') ? <img src={state.url} alt={`증빙서류 ${evidence.fileName}`} /> : <iframe src={state.url} title={`증빙서류 ${evidence.fileName}`} />}
    </div>
  )
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (requestId: number) => void }) {
  const courses = useCourseOptions(true, ['PREPARING', 'RECRUITING', 'IN_PROGRESS'])
  const [courseId, setCourseId] = useState('')
  const schedules = useApi(
    (signal) => (courseId ? api.getAll<ScheduleListItem>('/schedules', { course_id: courseId }, signal).then((r) => r.items) : Promise.resolve([] as ScheduleListItem[])),
    courseId,
  )
  const [scheduleId, setScheduleId] = useState('')
  const roster = useApi(
    (signal) => (scheduleId ? api.get<{ items: RosterItem[] }>(`/schedules/${scheduleId}/attendance-roster`, undefined, signal).then((r) => r.items) : Promise.resolve([] as RosterItem[])),
    scheduleId,
  )
  const [traineeId, setTraineeId] = useState('')
  const [reason, setReason] = useState('MEDICAL')
  const [reasonNote, setReasonNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!scheduleId || !traineeId) {
      setError('과정·회차·훈련생을 선택해 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await api.post<{ requestId: number }>('/excuse-requests', {
        trainee_id: Number(traineeId),
        schedule_id: Number(scheduleId),
        reason_type: reason,
        reason_note: reasonNote.trim() || undefined,
      })
      if (file) {
        const form = new FormData()
        form.append('file', file)
        try {
          await api.postForm(`/excuse-requests/${created.requestId}/evidence`, form)
        } catch (upErr) {
          // 신청은 등록됐으므로 목록으로 이동하고, 증빙은 상세 화면에서 다시 추가하게 한다
          window.alert(`신청은 등록했지만 증빙 파일을 올리지 못했습니다(${upErr instanceof ApiError ? upErr.message : '오류'}). 상세 화면에서 다시 추가해 주세요.`)
        }
      }
      onCreated(created.requestId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="공결 신청 등록" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-row">
          <label className="field">
            과정
            <select value={courseId} onChange={(e) => { setCourseId(e.target.value); setScheduleId(''); setTraineeId('') }}>
              <option value="">선택</option>
              {courses.data?.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.courseName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            회차
            <select value={scheduleId} onChange={(e) => { setScheduleId(e.target.value); setTraineeId('') }} disabled={!courseId}>
              <option value="">선택</option>
              {schedules.data?.map((s) => (
                <option key={s.scheduleId} value={s.scheduleId} disabled={s.status === 'CANCELLED'}>
                  {s.classDate} {s.roundNo}회차{s.status === 'CANCELLED' ? ' (휴강)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          훈련생
          <select value={traineeId} onChange={(e) => setTraineeId(e.target.value)} disabled={!scheduleId}>
            <option value="">선택</option>
            {roster.data?.map((r) => (
              <option key={r.traineeId} value={r.traineeId}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          사유
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(EXCUSE_REASON_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          신청 내용(선택)
          <textarea value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} rows={2} maxLength={500} />
        </label>
        <label>
          증빙서류(선택, 나중에 추가 가능 · PDF·PNG·JPG·WEBP, 10MB 이하)
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            등록
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}
