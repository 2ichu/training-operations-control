import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { InstructorListItem, Paged } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { InstructorStatusBadge } from '../../components/StatusBadge'
import { INSTRUCTOR_STATUS_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 20

// S11 강사 목록(system-design 7-A): 성명·상태 검색, 담당 과정 수. 강사 계정에는 서버가 본인 정보만 준다.
// 연락처는 마스킹된 값만 보인다. 행 클릭(성명) → 강사 상세(S12 조회 모드).
export function InstructorListPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const page = Number(get('page')) || 1
  const query = { name: get('name'), status: get('status'), page, size: PAGE_SIZE }
  const list = useApi((signal) => api.get<Paged<InstructorListItem>>('/instructors', query, signal), JSON.stringify(query))
  const [name, setName] = useState(get('name'))
  const items = list.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>강사 목록</h1>
        <div className="toolbar">
          {can('S13', 'R') && (
            <Link className="button" to="/schedules">
              배정 관리
            </Link>
          )}
          {can('S12', 'C') && (
            <Link className="button button-primary" to="/instructors/new">
              신규 등록
            </Link>
          )}
        </div>
      </div>

      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ name: name.trim() || undefined })
        }}
      >
        <label>
          성명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <button type="submit">검색</button>
        <label>
          상태
          <select value={get('status')} onChange={(e) => set({ status: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(INSTRUCTOR_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </form>

      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className={list.status === 'loading' && list.data ? 'panel is-refreshing' : 'panel'}>
        {!list.data && list.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 강사가 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>성명</th>
                <th>연락처</th>
                <th>상태</th>
                <th className="num">담당 과정 수</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.instructorId}>
                  <td>{can('S12', 'R') ? <Link to={`/instructors/${i.instructorId}`}>{i.name}</Link> : i.name}</td>
                  <td>{i.contact ?? '-'}</td>
                  <td>
                    <InstructorStatusBadge status={i.status} />
                  </td>
                  <td className="num">{i.assignedCourseCount}</td>
                  <td>{can('S13', 'R') && <Link to={`/schedules?instructor_id=${i.instructorId}`}>강의 일정</Link>}</td>
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
