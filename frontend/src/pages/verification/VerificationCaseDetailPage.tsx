import { type FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, api } from '../../api/client'
import type { VerificationCaseDetail } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { CaseStatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../format'
import { ACTION_TYPE_LABELS, CASE_STATUS_LABELS, ISSUE_CATEGORY_LABELS, label } from '../../labels'
import { NotFoundPage } from '../PlaceholderPages'
import { describeEvidence } from './evidence'

// S23 확인 필요 상세(system-design 7.3). 상태 전이는 baseline 3-4 전이표를 그대로 따르고, 서버가 최종 검증한다.
export function VerificationCaseDetailPage() {
  const { id } = useParams()
  const caseId = Number(id)
  const { can } = useAuth()
  const detail = useApi((signal) => api.get<VerificationCaseDetail>(`/verification-cases/${caseId}`, undefined, signal), String(caseId))

  if (!Number.isInteger(caseId) || caseId <= 0) return <NotFoundPage />
  if (detail.status === 'error' && detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />

  const data = detail.data
  return (
    <section className="page">
      <div className="page-header">
        <h1>확인 필요 상세 #{caseId}</h1>
        <Link to="/verification-cases">목록으로</Link>
      </div>
      {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
      {!data && detail.status === 'loading' && <Loading />}
      {data && (
        <div className={detail.status === 'loading' ? 'case-detail is-refreshing' : 'case-detail'}>
          <section className="panel" aria-label="요약">
            <dl className="summary-grid">
              <div>
                <dt>탐지유형</dt>
                <dd>{data.ruleCode === 'MANUAL' ? '수동생성' : `${data.ruleCode} ${data.ruleName}`}</dd>
              </div>
              <div>
                <dt>발생일시</dt>
                <dd>{formatDateTime(data.detectedAt)}</dd>
              </div>
              <div>
                <dt>상태</dt>
                <dd>
                  <CaseStatusBadge status={data.status} />
                </dd>
              </div>
              <div>
                <dt>우선순위</dt>
                <dd>{data.priority ? '우선' : '일반'}</dd>
              </div>
              <div>
                <dt>과정</dt>
                <dd>{can('S16', 'R') ? <Link to={`/courses/${data.courseId}`}>{data.courseName}</Link> : data.courseName}</dd>
              </div>
              <div>
                <dt>담당자</dt>
                <dd>{data.assigneeName ?? '미지정'}</dd>
              </div>
              <div>
                <dt>종결일시</dt>
                <dd>{formatDateTime(data.closedAt)}</dd>
              </div>
            </dl>
          </section>

          <EvidenceSection data={data} />

          <section className="panel" aria-labelledby="trainees-title">
            <h2 id="trainees-title">관련 훈련생</h2>
            {data.trainees.length === 0 ? (
              <EmptyText>관련 훈련생이 없는 건입니다(회차 단위 운영 이슈 등).</EmptyText>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>훈련생</th>
                    <th>관련 출결</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trainees.map((t) => (
                    <tr key={t.traineeId}>
                      <td>{can('S05', 'R') ? <Link to={`/trainees/${t.traineeId}`}>{t.name}</Link> : t.name}</td>
                      <td>{t.attendanceId ? `출결 #${t.attendanceId}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel" aria-labelledby="notes-title">
            <h2 id="notes-title">확인·조치 내용</h2>
            <dl className="notes">
              <dt>확인내용</dt>
              <dd>{data.confirmationNote ?? '-'}</dd>
              <dt>조치내용</dt>
              <dd>{data.actionNote ?? '-'}</dd>
            </dl>
            {can('S23', 'A') && <CaseActions data={data} onDone={detail.reload} />}
          </section>

          <section className="panel" aria-labelledby="history-title">
            <h2 id="history-title">처리이력</h2>
            {data.actionLogs.length === 0 ? (
              <EmptyText>아직 처리 이력이 없습니다.</EmptyText>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>일시</th>
                    <th>처리자</th>
                    <th>처리</th>
                    <th>상태 변화</th>
                    <th>내용</th>
                  </tr>
                </thead>
                <tbody>
                  {data.actionLogs.map((log) => (
                    <tr key={log.logId}>
                      <td>{formatDateTime(log.actionAt)}</td>
                      <td>{log.actorName}</td>
                      <td>{label(ACTION_TYPE_LABELS, log.actionType)}</td>
                      <td>
                        {log.previousStatus ? label(CASE_STATUS_LABELS, log.previousStatus) : '-'} → {log.newStatus ? label(CASE_STATUS_LABELS, log.newStatus) : '-'}
                      </td>
                      <td className="wrap">{log.note ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function EvidenceSection({ data }: { data: VerificationCaseDetail }) {
  const items = describeEvidence(data)
  return (
    <section className="panel" aria-labelledby="evidence-title">
      <h2 id="evidence-title">탐지 근거</h2>
      {data.relatedCourseIssue && (
        <div className="evidence-block">
          <h3>원본 특이사항 #{data.relatedCourseIssue.issueId}</h3>
          <p className="muted">분류: {label(ISSUE_CATEGORY_LABELS, data.relatedCourseIssue.category)}</p>
          <p className="wrap">{data.relatedCourseIssue.content}</p>
        </div>
      )}
      {data.relatedOperationLog && (
        <div className="evidence-block">
          <h3>관련 운영일지 #{data.relatedOperationLog.operationLogId}</h3>
          <p className="muted">작성: {formatDateTime(data.relatedOperationLog.writtenAt)}</p>
          <p className="wrap">{data.relatedOperationLog.content}</p>
        </div>
      )}
      {items.length === 0 && !data.relatedCourseIssue && <EmptyText>기록된 근거 항목이 없습니다.</EmptyText>}
      {items.map((fields, index) => (
        <dl key={index} className="evidence-item">
          {fields.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      ))}
    </section>
  )
}

type Transition = { path: string; field: 'confirmation_note' | 'action_note' | 'reason'; fieldLabel: string; required: boolean; button: string }

// baseline 3-4 전이표: 현재 상태에서 가능한 처리만 보여준다
const TRANSITIONS: Record<string, Transition[]> = {
  NEEDS_CHECK: [{ path: 'start-review', field: 'confirmation_note', fieldLabel: '확인내용', required: true, button: '확인 시작' }],
  PRIORITY_CHECK: [{ path: 'start-review', field: 'confirmation_note', fieldLabel: '확인내용', required: true, button: '확인 시작' }],
  FOLLOW_UP: [{ path: 'start-review', field: 'confirmation_note', fieldLabel: '확인내용', required: true, button: '확인 시작' }],
  IN_REVIEW: [
    { path: 'complete-confirmation', field: 'confirmation_note', fieldLabel: '확인내용(선택, 비우면 기존 내용 유지)', required: false, button: '확인 완료 종결' },
    { path: 'require-action', field: 'action_note', fieldLabel: '조치내용', required: true, button: '조치 필요로 전환' },
  ],
  ACTION_REQUIRED: [{ path: 'complete-action', field: 'action_note', fieldLabel: '조치내용(선택, 비우면 기존 내용 유지)', required: false, button: '조치 완료' }],
  CONFIRMED: [{ path: 'reopen', field: 'reason', fieldLabel: '재오픈 사유', required: true, button: '재오픈(추가확인)' }],
  ACTION_DONE: [{ path: 'reopen', field: 'reason', fieldLabel: '재오픈 사유', required: true, button: '재오픈(추가확인)' }],
}

function CaseActions({ data, onDone }: { data: VerificationCaseDetail; onDone: () => void }) {
  const transitions = TRANSITIONS[data.status] ?? []
  // 폼은 상태가 바뀌면 새로 그려지므로(key), 동시 처리 안내는 여기서 유지한다
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <div className="case-actions">
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {transitions.map((t) => (
        <TransitionForm
          key={`${data.status}:${t.path}`}
          caseId={data.caseId}
          transition={t}
          onDone={() => {
            setNotice(null)
            onDone()
          }}
          onConflict={() => {
            setNotice('다른 사용자가 먼저 처리해 상태가 바뀌었습니다. 최신 내용을 다시 불러왔습니다.')
            onDone()
          }}
        />
      ))}
    </div>
  )
}

function TransitionForm({ caseId, transition, onDone, onConflict }: { caseId: number; transition: Transition; onDone: () => void; onConflict: () => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const max = transition.field === 'reason' ? 500 : 2000

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (transition.required && !value) return setError(`${transition.fieldLabel}을(를) 입력해 주세요.`)
    setSubmitting(true)
    setError(null)
    try {
      await api.post(`/verification-cases/${caseId}/${transition.path}`, value ? { [transition.field]: value } : {})
      setText('')
      onDone()
    } catch (e) {
      // 409: 그 사이 다른 담당자가 먼저 처리함(system-design 7.2 동시 처리) — 최신 상태로 다시 불러온다
      if (e instanceof ApiError && e.code === 'INVALID_STATE_TRANSITION') {
        onConflict()
      } else {
        setError(e instanceof ApiError ? e.message : '처리하지 못했습니다.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const inputId = `transition-${transition.path}`
  return (
    <form className="transition-form" onSubmit={onSubmit} noValidate>
      <label htmlFor={inputId}>{transition.fieldLabel}</label>
      <textarea id={inputId} value={text} onChange={(e) => setText(e.target.value)} maxLength={max} rows={3} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button-primary" disabled={submitting}>
        {submitting ? '처리 중…' : transition.button}
      </button>
    </form>
  )
}
