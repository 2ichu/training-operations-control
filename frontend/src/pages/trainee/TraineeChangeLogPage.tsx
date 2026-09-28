import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { Paged, TraineeChangeLog } from '../../api/types'
import { useApi } from '../../api/useApi'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { formatDateTime } from '../../format'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { diffFields } from './change-diff'

const PAGE_SIZE = 50
const ENTITY_LABELS: Record<string, string> = { TRAINEE: '인적정보', ENROLLMENT: '등록 건' }

// S06 훈련생 변경이력(system-design 7-A): trainee_change_log 조회 전용. 변경 전/후는 바뀐 필드만 나란히 보여준다.
// 연락처·생년월일은 로그에도 마스킹된 값만 남아 있다(audit-registry).
export function TraineeChangeLogPage() {
  const { get, set } = useUrlFilters()
  const page = Number(get('page')) || 1
  const query = { trainee_id: get('trainee_id'), trainee_name: get('trainee_name'), entity_type: get('entity_type'), from: get('from'), to: get('to'), page, size: PAGE_SIZE }
  const logs = useApi((signal) => api.get<Paged<TraineeChangeLog>>('/trainee-change-logs', query, signal), JSON.stringify(query))
  const [name, setName] = useState(get('trainee_name'))
  const items = logs.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>훈련생 변경이력</h1>
      </div>
      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ trainee_name: name.trim() || undefined, trainee_id: undefined })
        }}
      >
        <label>
          훈련생명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <button type="submit">검색</button>
        <label>
          대상 구분
          <select value={get('entity_type')} onChange={(e) => set({ entity_type: e.target.value })}>
            <option value="">전체</option>
            <option value="TRAINEE">인적정보</option>
            <option value="ENROLLMENT">등록 건</option>
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
      {get('trainee_id') && (
        <p className="notice">
          특정 훈련생의 이력만 보고 있습니다.{' '}
          <button type="button" className="button-link" onClick={() => set({ trainee_id: undefined })}>
            전체 보기
          </button>
        </p>
      )}

      {logs.status === 'error' && <ErrorText error={logs.error} onRetry={logs.reload} />}
      <div className={logs.status === 'loading' && logs.data ? 'panel is-refreshing' : 'panel'}>
        {!logs.data && logs.status === 'loading' ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 변경이력이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>변경일시</th>
                <th>훈련생</th>
                <th>대상 구분</th>
                <th>변경자</th>
                <th>변경 내용(전 → 후)</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.logId}>
                  <td>{formatDateTime(l.changedAt)}</td>
                  <td>
                    <Link to={`/trainees/${l.traineeId}`}>{l.traineeName}</Link>
                  </td>
                  <td>
                    {ENTITY_LABELS[l.entityType] ?? l.entityType}
                    {l.courseName ? <span className="muted"> · {l.courseName}</span> : null}
                  </td>
                  <td>{l.changedByName}</td>
                  <td>
                    <ul className="diff">
                      {diffFields(l.beforeValue, l.afterValue).map((d) => (
                        <li key={d.field}>
                          <span className="muted">{d.label}</span> <del>{d.before}</del> → <ins>{d.after}</ins>
                        </li>
                      ))}
                    </ul>
                  </td>
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
