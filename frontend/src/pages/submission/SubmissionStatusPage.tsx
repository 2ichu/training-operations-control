import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { SubmissionStatusRow } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { ReviewStatusBadge, SubmitStatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../format'
import { REVIEW_STATUS_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { RegisterDialog, ReRegisterDialog } from './SubmissionDialogs'

type Dialog = { kind: 'register'; traineeId?: number } | { kind: 'reregister'; row: SubmissionStatusRow }

// S19 결과물 제출현황(system-design 7-A, C2·D-01): 확정 훈련생 × 결과물. 행이 없으면 계산값 "미제출"(C1과 같은 원칙).
// 결과물은 운영담당자가 대신 등록한다(제출일 = 훈련생이 실제 낸 시점, 등록일시 = 시스템에 올린 시점). 강사는 본인 배정 과정 조회만.
export function SubmissionStatusPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const courses = useCourseOptions()
  const query = { trainee_name: get('trainee_name'), review_status: get('review_status') }
  const list = useApi(
    (signal) => (courseId ? api.get<{ items: SubmissionStatusRow[] }>(`/courses/${courseId}/submission-status`, query, signal).then((r) => r.items) : Promise.resolve(null)),
    `${courseId}:${JSON.stringify(query)}`,
  )
  const [name, setName] = useState(get('trainee_name'))
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const rows = list.data ?? []
  // 등록 대상 = 확정 훈련생 전체(검토 상태로 거른 목록이면 미제출자가 빠지므로 필터 없는 목록일 때만 제공)
  const candidates = [...new Map(rows.map((r) => [r.traineeId, { traineeId: r.traineeId, traineeName: r.traineeName }])).values()]
  const canRegister = can('S19', 'C') && !get('review_status')

  const saved = (message: string) => {
    setDialog(null)
    setNotice(message)
    list.reload()
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>결과물 제출현황</h1>
        {courseId && canRegister && list.data && (
          <button type="button" className="button-primary" onClick={() => setDialog({ kind: 'register' })}>
            결과물 등록
          </button>
        )}
      </div>
      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ trainee_name: name.trim() || undefined })
        }}
      >
        <label>
          과정(필수)
          <select value={courseId} onChange={(e) => set({ course_id: e.target.value })}>
            <option value="">선택</option>
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
        <label>
          검토상태
          <select value={get('review_status')} onChange={(e) => set({ review_status: e.target.value })}>
            <option value="">전체(미제출 포함)</option>
            {Object.entries(REVIEW_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </form>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!courseId && <EmptyText>과정을 선택해 주세요.</EmptyText>}
      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      {list.data && (
        <div className={list.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
          {rows.length === 0 ? (
            <EmptyText>조건에 맞는 확정 훈련생이 없습니다.</EmptyText>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>훈련생명</th>
                  <th>제목</th>
                  <th>제출일</th>
                  <th>등록일시</th>
                  <th>제출상태</th>
                  <th>검토상태</th>
                  <th className="num">버전</th>
                  <th>등록자</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.traineeId}:${r.submissionId ?? 'none'}`}>
                    <td>{r.traineeName}</td>
                    <td>{r.submissionId !== null && can('S21', 'R') ? <Link to={`/submissions/${r.submissionId}`}>{r.title}</Link> : (r.title ?? '-')}</td>
                    <td>{formatDateTime(r.submittedAt)}</td>
                    <td>{formatDateTime(r.registeredAt)}</td>
                    <td>
                      <SubmitStatusBadge status={r.displayStatus} />
                    </td>
                    <td>{r.reviewStatus ? <ReviewStatusBadge status={r.reviewStatus} /> : '-'}</td>
                    <td className="num">{r.version === null ? '-' : `v${r.version}`}</td>
                    <td>{r.registeredByName ?? '-'}</td>
                    <td>
                      <div className="row-actions">
                        {r.submissionId === null && canRegister && (
                          <button type="button" onClick={() => setDialog({ kind: 'register', traineeId: r.traineeId })} aria-label={`${r.traineeName} 결과물 등록`}>
                            결과물 등록
                          </button>
                        )}
                        {r.submissionId !== null && can('S19', 'U') && (
                          <button type="button" onClick={() => setDialog({ kind: 'reregister', row: r })} aria-label={`${r.traineeName} ${r.title} 재등록`}>
                            재등록
                          </button>
                        )}
                        {r.submissionId !== null && can('S21', 'C') && (
                          <Link className="button" to={`/submissions/${r.submissionId}`} aria-label={`${r.traineeName} ${r.title} 검토`}>
                            검토
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {dialog?.kind === 'register' && <RegisterDialog courseId={courseId} candidates={candidates} initialTraineeId={dialog.traineeId} onClose={() => setDialog(null)} onSaved={saved} />}
      {dialog?.kind === 'reregister' && <ReRegisterDialog row={dialog.row} onClose={() => setDialog(null)} onSaved={saved} />}
    </section>
  )
}
