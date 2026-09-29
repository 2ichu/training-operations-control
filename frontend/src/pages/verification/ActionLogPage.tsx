import { Link } from 'react-router'
import { api } from '../../api/client'
import type { ActionLogEntry, CourseSummary, Paged } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth, useCurrentUser } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { formatDateTime } from '../../format'
import { ACTION_TYPE_LABELS, CASE_STATUS_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 50

// S24 조치이력(baseline 5-2): verification_action_log 조회 전용. "내 담당"은 확인 건의 담당자 기준(API assignee_id).
export function ActionLogPage() {
  const { can } = useAuth()
  const { user } = useCurrentUser()
  const { get, set } = useUrlFilters()
  const page = Number(get('page')) || 1
  const query = {
    course_id: get('course_id'),
    from: get('from'),
    to: get('to'),
    action_type: get('action_type'),
    assignee_id: get('mine') === '1' ? user.userId : undefined,
    page,
    size: PAGE_SIZE,
  }
  const logs = useApi((signal) => api.get<Paged<ActionLogEntry>>('/verification-action-logs', query, signal), JSON.stringify(query))
  const courses = useApi((signal) => api.getAll<CourseSummary>('/courses', {}, signal), 'courses')
  const items = logs.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>조치이력</h1>
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          기간(부터)
          <input type="date" value={get('from')} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          기간(까지)
          <input type="date" value={get('to')} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label>
          과정
          <select value={get('course_id')} onChange={(e) => set({ course_id: e.target.value })}>
            <option value="">전체</option>
            {courses.data?.items.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          처리 유형
          <select value={get('action_type')} onChange={(e) => set({ action_type: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(ACTION_TYPE_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={get('mine') === '1'} onChange={(e) => set({ mine: e.target.checked ? '1' : undefined })} />내 담당 건만
        </label>
      </form>

      {logs.status === 'error' && <ErrorText error={logs.error} onRetry={logs.reload} />}
      <div className={logs.status === 'loading' && logs.data ? 'panel is-refreshing' : 'panel'}>
        {!logs.data && logs.status === 'loading' ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 조치이력이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>일시</th>
                <th>사건</th>
                <th>과정</th>
                <th>처리자</th>
                <th>처리</th>
                <th>상태 변화</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.logId}>
                  <td>{formatDateTime(log.actionAt)}</td>
                  <td>{can('S23', 'R') ? <Link to={`/verification-cases/${log.caseId}`}>#{log.caseId}</Link> : `#${log.caseId}`}</td>
                  <td>{log.courseName}</td>
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
      </div>
      {logs.data && logs.data.total > 0 && <Pagination page={logs.data.page} size={logs.data.size} total={logs.data.total} onChange={(p) => set({ page: String(p) })} />}
    </section>
  )
}
