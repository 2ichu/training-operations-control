import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { CourseListItem, ManagerCandidate, Paged } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { CourseStatusBadge } from '../../components/StatusBadge'
import { COURSE_STATUS_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 20

// S15 과정 목록(system-design 7-A). 역할별 범위는 서버가 정한다(강사는 본인 배정 과정만).
// 담당자 검색은 담당자 후보 목록(S16:U — 운영담당자)을 볼 수 있을 때만 제공한다.
export function CourseListPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const canCreate = can('S16', 'C')
  const canPickManager = can('S16', 'U')
  const page = Number(get('page')) || 1
  const query = { name: get('name'), status: get('status'), from: get('from'), to: get('to'), manager_user_id: get('manager_user_id'), page, size: PAGE_SIZE }
  const list = useApi((signal) => api.get<Paged<CourseListItem>>('/courses', query, signal), JSON.stringify(query))
  const managers = useApi(
    (signal) => (canPickManager ? api.get<{ items: ManagerCandidate[] }>('/courses/manager-candidates', undefined, signal) : Promise.resolve({ items: [] })),
    String(canPickManager),
  )
  const [name, setName] = useState(get('name'))
  const items = list.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>과정 목록</h1>
        {canCreate && (
          <Link className="button button-primary" to="/courses/new">
            신규 과정 등록
          </Link>
        )}
      </div>

      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ name: name.trim() || undefined })
        }}
      >
        <label>
          과정명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </label>
        <button type="submit">검색</button>
        <label>
          상태
          <select value={get('status')} onChange={(e) => set({ status: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(COURSE_STATUS_LABELS).map(([code, text]) => (
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
        {canPickManager && (
          <label>
            담당자
            <select value={get('manager_user_id')} onChange={(e) => set({ manager_user_id: e.target.value })}>
              <option value="">전체</option>
              {managers.data?.items.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>

      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className={list.status === 'loading' && list.data ? 'panel is-refreshing' : 'panel'}>
        {!list.data && list.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 과정이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>과정명</th>
                <th>기간</th>
                <th>교육장</th>
                <th>담당자</th>
                <th>상태</th>
                <th className="num">확정 훈련생</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.courseId}>
                  <td>
                    <Link to={`/courses/${c.courseId}`}>{c.courseName}</Link>
                  </td>
                  <td>
                    {c.startDate} ~ {c.endDate}
                  </td>
                  <td>{c.trainingSite}</td>
                  <td>{c.managerName ?? '-'}</td>
                  <td>
                    <CourseStatusBadge status={c.status} />
                  </td>
                  <td className="num">{c.confirmedTraineeCount}명</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data && list.data.total > 0 && <Pagination page={list.data.page} size={list.data.size} total={list.data.total} onChange={(p) => set({ page: String(p) })} />}
    </section>
  )
}
