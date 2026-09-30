import { type FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiError, api, attachmentUrl } from '../../api/client'
import type { SubmissionDetail } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { ReviewStatusBadge, SubmitStatusBadge } from '../../components/StatusBadge'
import { formatBytes, formatDateTime } from '../../format'
import { label, REVIEW_STATUS_LABELS } from '../../labels'
import { NotFoundPage } from '../PlaceholderPages'

const RESULTS = ['APPROVED', 'REVISION_REQUESTED', 'REJECTED'] as const

// S21 결과물 검토(system-design 7-A): 버전별 파일 + 검토 입력 + 버전별 검토이력. 검토는 운영담당자만(S21:C, H4),
// 관리자/책임자·시스템 관리자는 읽기만, 강사는 접근 불가. 보완요청은 시스템 밖에서 전달하고 담당자가 S19 에서 재등록을 기다린다.
export function SubmissionDetailPage() {
  const { id } = useParams()
  const submissionId = Number(id)
  const { can } = useAuth()
  const detail = useApi((signal) => api.get<SubmissionDetail>(`/submissions/${submissionId}`, undefined, signal), String(submissionId))
  const [notice, setNotice] = useState<string | null>(null)

  if (!Number.isInteger(submissionId) || submissionId <= 0) return <NotFoundPage />
  if (detail.status === 'error' && detail.error instanceof ApiError && detail.error.status === 404) return <NotFoundPage />
  const s = detail.data
  const versions = s ? [...new Set([...s.attachments.map((a) => a.entityVersion), ...s.reviews.map((r) => r.version), s.version])].sort((a, b) => b - a) : []

  return (
    <section className="page">
      <div className="page-header">
        <h1>{s ? `${s.title} — ${s.traineeName}` : '결과물 검토'}</h1>
        {s && can('S19', 'R') && <Link to={`/submissions?course_id=${s.courseId}`}>제출현황으로</Link>}
      </div>
      {detail.status === 'error' && <ErrorText error={detail.error} onRetry={detail.reload} />}
      {!s && detail.status === 'loading' && <Loading />}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {s && (
        <div className={detail.status === 'loading' ? 'case-detail is-refreshing' : 'case-detail'}>
          <section className="panel" aria-label="결과물 정보">
            <dl className="summary-grid">
              <div>
                <dt>과정</dt>
                <dd>{s.courseName}</dd>
              </div>
              <div>
                <dt>현재 버전</dt>
                <dd>v{s.version}</dd>
              </div>
              <div>
                <dt>제출일(원본)</dt>
                <dd>{formatDateTime(s.submittedAt)}</dd>
              </div>
              <div>
                <dt>제출상태</dt>
                <dd>
                  <SubmitStatusBadge status={s.submitStatus} />
                </dd>
              </div>
              <div>
                <dt>검토상태</dt>
                <dd>
                  <ReviewStatusBadge status={s.reviewStatus} />
                </dd>
              </div>
            </dl>
          </section>

          {can('S21', 'C') && (
            <ReviewForm
              submission={s}
              onSaved={(message) => {
                setNotice(message)
                detail.reload()
              }}
            />
          )}

          <section className="panel" aria-label="버전별 파일·검토이력">
            <h2>버전별 파일·검토이력</h2>
            {versions.map((v) => {
              const files = s.attachments.filter((a) => a.entityVersion === v)
              const reviews = s.reviews.filter((r) => r.version === v)
              return (
                <section key={v} className="version-block" aria-label={`v${v}`}>
                  <h3>
                    v{v} {v === s.version && <span className="badge badge-neutral">현재</span>}
                  </h3>
                  {files.length === 0 ? (
                    <p className="muted">파일 없음</p>
                  ) : (
                    <ul>
                      {files.map((a) => (
                        <li key={a.attachmentId}>
                          <a href={attachmentUrl(a.attachmentId)} download>
                            {a.fileName}
                          </a>{' '}
                          <span className="muted">
                            {formatBytes(a.fileSize)} · {formatDateTime(a.uploadedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {reviews.length === 0 ? (
                    <p className="muted">검토 기록 없음</p>
                  ) : (
                    <ol className="timeline">
                      {reviews.map((r) => (
                        <li key={r.logId}>
                          <ReviewStatusBadge status={r.reviewResult} /> <span className="muted">{formatDateTime(r.reviewedAt)} · {r.reviewerName}</span>
                          {r.reviewComment && <p className="wrap">{r.reviewComment}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )
            })}
            {versions.length === 0 && <EmptyText>파일·검토 기록이 없습니다.</EmptyText>}
          </section>
        </div>
      )}
    </section>
  )
}

function ReviewForm({ submission, onSaved }: { submission: SubmissionDetail; onSaved: (message: string) => void }) {
  const [result, setResult] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!result) return setError('검토결과를 선택해 주세요.')
    setBusy(true)
    setError(null)
    try {
      await api.post(`/submissions/${submission.submissionId}/reviews`, { review_result: result, ...(comment.trim() ? { review_comment: comment.trim() } : {}) })
      setResult('')
      setComment('')
      onSaved(
        result === 'REVISION_REQUESTED'
          ? `v${submission.version} 보완요청을 기록했습니다. 훈련생에게는 시스템 밖에서 전달하고, 다시 받으면 제출현황에서 재등록해 주세요.`
          : `v${submission.version} 검토결과(${label(REVIEW_STATUS_LABELS, result)})를 저장했습니다.`,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="panel course-form" onSubmit={submit} noValidate aria-label="검토 입력">
      <h2>v{submission.version} 검토</h2>
      <fieldset className="radio-group">
        <legend>검토결과</legend>
        {RESULTS.map((code) => (
          <label key={code}>
            <input type="radio" name="review_result" value={code} checked={result === code} onChange={() => setResult(code)} /> {label(REVIEW_STATUS_LABELS, code)}
          </label>
        ))}
      </fieldset>
      <label className="stacked">
        검토내용
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={3} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={busy}>
          {busy ? '저장 중…' : '저장'}
        </button>
      </div>
    </form>
  )
}
