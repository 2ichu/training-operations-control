import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api } from '../../api/client'
import type { CourseIssue, Paged } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { CaseStatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../format'
import { ACTIVE_CASE_STATUSES, ISSUE_CATEGORY_LABELS, ISSUE_STATUS_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { CourseIssueFormDialog, EscalateDialog, type RegisterInitial, ResolveDialog } from './CourseIssueDialogs'

const PAGE_SIZE = 20
const SUMMARY_LENGTH = 40

type Dialog = { kind: 'register'; initial?: RegisterInitial } | { kind: 'edit' | 'escalate' | 'resolve'; issue: CourseIssue }

// S18 특이사항(system-design 7-A): 훈련 중 발생한 사항 기록 → 필요하면 "확인 필요로 전환"(수동 생성 경로, STEP 8.3).
// 전환하면 특이사항은 확인중이 되고, 이후 두 상태는 독립이다(H6) — 목록은 연결된 확인 건의 현재 상태를 참고 열로 보여준다.
// 강사는 본인 등록 건만 보고(서버), 등록만 한다. 운영담당자는 수정·전환·조치완료, 관리자/책임자는 전환만.
export function CourseIssuePage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const location = useLocation()
  const navigate = useNavigate()
  const page = Number(get('page')) || 1
  const query = { course_id: get('course_id'), round_no: get('round_no'), status: get('status'), page, size: PAGE_SIZE }
  const list = useApi((signal) => api.get<Paged<CourseIssue>>('/course-issues', query, signal), JSON.stringify(query))
  const courses = useCourseOptions()
  // S17 "특이사항으로 등록"에서 넘어오면 등록 폼을 과정·회차·내용을 채워서 연다(한 번만 — state 는 바로 비운다)
  const handoff = (location.state as { register?: { scheduleId: number; content: string } } | null)?.register
  const [dialog, setDialog] = useState<Dialog | null>(() =>
    handoff && can('S18', 'C') ? { kind: 'register', initial: { courseId: get('course_id'), scheduleId: handoff.scheduleId, content: handoff.content } } : null,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const items = list.data?.items ?? []

  const close = () => {
    setDialog(null)
    if (handoff) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }
  const saved = (message: string) => {
    close()
    setNotice(message)
    list.reload()
  }

  return (
    <section className="page">
      <div className="page-header">
        <h1>특이사항</h1>
        {can('S18', 'C') && (
          <button type="button" className="button-primary" onClick={() => setDialog({ kind: 'register', initial: { courseId: get('course_id') } })}>
            등록
          </button>
        )}
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          과정
          <select value={get('course_id')} onChange={(e) => set({ course_id: e.target.value })}>
            <option value="">전체</option>
            {courses.data?.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          회차
          <input type="number" min={1} value={get('round_no')} onChange={(e) => set({ round_no: e.target.value })} className="narrow" />
        </label>
        <label>
          상태
          <select value={get('status')} onChange={(e) => set({ status: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(ISSUE_STATUS_LABELS).map(([code, text]) => (
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
      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className={list.status === 'loading' && list.data ? 'panel is-refreshing' : 'panel'}>
        {!list.data && list.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 특이사항이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>등록일</th>
                <th>과정</th>
                <th>회차</th>
                <th>카테고리</th>
                <th>내용</th>
                <th>상태</th>
                <th>연결 확인 건</th>
                <th>등록자</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const activeCase = i.verificationCaseStatus !== null && ACTIVE_CASE_STATUSES.includes(i.verificationCaseStatus)
                return (
                  <tr key={i.issueId}>
                    <td>{formatDateTime(i.reportedAt)}</td>
                    <td>{i.courseName}</td>
                    <td>{i.roundNo === null ? '-' : `${i.roundNo}회차`}</td>
                    <td>
                      <span className="badge badge-neutral">{label(ISSUE_CATEGORY_LABELS, i.category)}</span>
                    </td>
                    <td className="wrap" title={i.content}>
                      {i.content.length > SUMMARY_LENGTH ? `${i.content.slice(0, SUMMARY_LENGTH)}…` : i.content}
                    </td>
                    <td>
                      <span className={i.status === 'RESOLVED' ? 'badge badge-muted' : 'badge badge-neutral'}>{label(ISSUE_STATUS_LABELS, i.status)}</span>
                    </td>
                    <td>
                      {i.verificationCaseId === null || i.verificationCaseStatus === null ? (
                        '-'
                      ) : can('S23', 'R') ? (
                        <Link to={`/verification-cases/${i.verificationCaseId}`}>
                          <CaseStatusBadge status={i.verificationCaseStatus} />
                        </Link>
                      ) : (
                        <CaseStatusBadge status={i.verificationCaseStatus} />
                      )}
                    </td>
                    <td>{i.reportedByName}</td>
                    <td>
                      <div className="row-actions">
                        {can('S18', 'U') && i.status !== 'RESOLVED' && (
                          <button type="button" onClick={() => setDialog({ kind: 'edit', issue: i })}>
                            수정
                          </button>
                        )}
                        {can('S18', 'A') && !activeCase && i.status !== 'RESOLVED' && (
                          <button type="button" onClick={() => setDialog({ kind: 'escalate', issue: i })}>
                            확인 필요로 전환
                          </button>
                        )}
                        {can('S18', 'U') && i.status !== 'RESOLVED' && (
                          <button type="button" onClick={() => setDialog({ kind: 'resolve', issue: i })}>
                            조치완료
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {list.data && list.data.total > 0 && <Pagination page={list.data.page} size={list.data.size} total={list.data.total} onChange={(p) => set({ page: String(p) })} />}

      {dialog?.kind === 'register' && <CourseIssueFormDialog initial={dialog.initial} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'edit' && <CourseIssueFormDialog issue={dialog.issue} onClose={close} onSaved={saved} />}
      {dialog?.kind === 'escalate' && <EscalateDialog issue={dialog.issue} onClose={close} onExisting={saved} />}
      {dialog?.kind === 'resolve' && <ResolveDialog issue={dialog.issue} onClose={close} onSaved={saved} />}
    </section>
  )
}
