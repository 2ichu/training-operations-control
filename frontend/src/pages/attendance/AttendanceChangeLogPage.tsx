import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { AttendanceChangeLog, Paged } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { diffFields } from '../../diff'
import { formatDateTime } from '../../format'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 50
// 시스템 행위자(공식 출결 대사 등)는 changed_by 가 없다(attendance_change_log.actor_type)
const ACTOR_LABELS: Record<string, string> = { SYSTEM_BATCH: '시스템(배치)', SYSTEM_API: '시스템(연동)' }

// S10 출결 수정이력(system-design 7-A): attendance_change_log 조회 전용. 같은 건의 반복 수정도 모두 시간순으로 보여준다.
// RULE_05·06(반복 수정 탐지)의 판단 근거와 같은 데이터다.
export function AttendanceChangeLogPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const page = Number(get('page')) || 1
  const query = { course_id: get('course_id'), trainee_name: get('trainee_name'), from: get('from'), to: get('to'), page, size: PAGE_SIZE }
  const logs = useApi((signal) => api.get<Paged<AttendanceChangeLog>>('/attendance-change-logs', query, signal), JSON.stringify(query))
  const courses = useCourseOptions()
  const [name, setName] = useState(get('trainee_name'))
  const items = logs.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>출결 수정이력</h1>
      </div>
      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ trainee_name: name.trim() || undefined })
        }}
      >
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
          훈련생명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <button type="submit">검색</button>
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
          <EmptyText>조건에 맞는 수정이력이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>변경일시</th>
                <th>훈련생</th>
                <th>회차</th>
                <th>변경 내용(전 → 후)</th>
                <th>변경자</th>
                <th>사유</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.logId}>
                  <td>{formatDateTime(l.changedAt)}</td>
                  <td>{can('S05', 'R') ? <Link to={`/trainees/${l.traineeId}?course_id=${l.courseId}`}>{l.traineeName}</Link> : l.traineeName}</td>
                  <td>
                    {l.courseName} · {l.roundNo}회차 <span className="muted">({l.classDate})</span>
                  </td>
                  <td>
                    <ul className="diff">
                      {diffFields(l.beforeValue, l.afterValue).map((d) => (
                        <li key={d.field}>
                          <span className="muted">{d.label}</span> <del>{d.before}</del> → <ins>{d.after}</ins>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>{l.actorType === 'USER' ? (l.changedByName ?? '-') : (ACTOR_LABELS[l.actorType] ?? l.actorType)}</td>
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
