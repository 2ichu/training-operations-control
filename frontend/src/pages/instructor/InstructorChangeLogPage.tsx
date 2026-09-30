import { api } from '../../api/client'
import type { InstructorChangeLog, InstructorListItem, Paged } from '../../api/types'
import { useApi } from '../../api/useApi'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { diffFields } from '../../diff'
import { formatDateTime } from '../../format'
import { ASSIGNMENT_STATUS_LABELS, INSTRUCTOR_STATUS_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 50
const ENTITY_LABELS: Record<string, string> = { INSTRUCTOR: '강사 정보', ASSIGNMENT: '강사 배정' }

// S14 강사 변경이력(system-design 7-A): instructor_change_log 조회 전용. 강사 정보 수정(S12)과 배정 취소(S13)가 남는다.
// 강사를 고르면 그 강사의 정보 이력과 배정 이력을 함께 본다. 연락처는 로그에도 마스킹된 값만 있다.
export function InstructorChangeLogPage() {
  const { get, set } = useUrlFilters()
  const page = Number(get('page')) || 1
  const query = { instructor_id: get('instructor_id'), entity_type: get('entity_type'), from: get('from'), to: get('to'), page, size: PAGE_SIZE }
  const logs = useApi((signal) => api.get<Paged<InstructorChangeLog>>('/instructor-change-logs', query, signal), JSON.stringify(query))
  const instructors = useApi((signal) => api.getAll<InstructorListItem>('/instructors', {}, signal).then((r) => r.items), 'all')
  const items = logs.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>강사 변경이력</h1>
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          강사
          <select value={get('instructor_id')} onChange={(e) => set({ instructor_id: e.target.value })}>
            <option value="">전체</option>
            {instructors.data?.map((i) => (
              <option key={i.instructorId} value={i.instructorId}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          대상 구분
          <select value={get('entity_type')} onChange={(e) => set({ entity_type: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(ENTITY_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          기간(부터)
          <input type="date" value={get('from')} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          기간(까지)
          <input type="date" value={get('to')} onChange={(e) => set({ to: e.target.value })} />
        </label>
      </form>

      {logs.status === 'error' && <ErrorText error={logs.error} onRetry={logs.reload} />}
      <div className={logs.status === 'loading' && logs.data ? 'panel is-refreshing' : 'panel'}>
        {!logs.data && logs.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 변경이력이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>변경일시</th>
                <th>대상 구분</th>
                <th>대상</th>
                <th>변경 내용(전 → 후)</th>
                <th>변경자</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.logId}>
                  <td>{formatDateTime(l.changedAt)}</td>
                  <td>{ENTITY_LABELS[l.entityType] ?? l.entityType}</td>
                  <td>
                    {l.instructorName ?? '-'}
                    {l.entityType === 'ASSIGNMENT' && (
                      <span className="muted">
                        {' '}
                        · {l.courseName} {l.roundNo === null ? '과정 전체' : `${l.roundNo}회차`}
                      </span>
                    )}
                  </td>
                  <td>
                    <ul className="diff">
                      {diffFields(l.beforeValue, l.afterValue, l.entityType === 'ASSIGNMENT' ? ASSIGNMENT_STATUS_LABELS : INSTRUCTOR_STATUS_LABELS).map((d) => (
                        <li key={d.field}>
                          <span className="muted">{d.label}</span> <del>{d.before}</del> → <ins>{d.after}</ins>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{l.changedByName}</td>
                  <td className="wrap">{l.reason}</td>
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
