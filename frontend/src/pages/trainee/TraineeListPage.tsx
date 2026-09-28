import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { Paged, TraineeListItem } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { formatDateTime } from '../../format'
import { ENROLLMENT_STATUS_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const PAGE_SIZE = 20
// 확정 이후 상태(P1-21: 상태 미지정 시 서버도 이 범위만 돌려준다)
const STATUS_OPTIONS = ['CONFIRMED', 'COMPLETED', 'DROPPED', 'EXPELLED']
// 연락처 검색은 4자 이상(마스킹 우회 방지, 서버와 같은 기준 — P1-21)
const MIN_CONTACT = 4

// S03 훈련생 목록(system-design 7-A): 확정 이후 훈련생 조회. 연락처·생년월일은 마스킹된 값만 보인다.
export function TraineeListPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const page = Number(get('page')) || 1
  const query = { course_id: get('course_id'), name: get('name'), contact: get('contact'), status: get('status'), page, size: PAGE_SIZE }
  const list = useApi((signal) => api.get<Paged<TraineeListItem>>('/trainees', query, signal), JSON.stringify(query))
  const courses = useCourseOptions()
  const [name, setName] = useState(get('name'))
  const [contact, setContact] = useState(get('contact'))
  const [contactError, setContactError] = useState<string | null>(null)
  const items = list.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>훈련생 목록</h1>
        {can('S04', 'C') && (
          <Link className="button button-primary" to="/trainees/new">
            신규 등록
          </Link>
        )}
      </div>

      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          const c = contact.trim()
          if (c && c.length < MIN_CONTACT) return setContactError(`연락처는 ${MIN_CONTACT}자 이상 입력해 주세요.`)
          setContactError(null)
          set({ name: name.trim() || undefined, contact: c || undefined })
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
          상태
          <select value={get('status')} onChange={(e) => set({ status: e.target.value })}>
            <option value="">전체(확정 이후)</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {label(ENROLLMENT_STATUS_LABELS, s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          성명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <label>
          연락처(4자 이상)
          <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={50} aria-invalid={contactError ? true : undefined} />
        </label>
        <button type="submit">검색</button>
      </form>
      {contactError && (
        <p className="form-error" role="alert">
          {contactError}
        </p>
      )}

      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className={list.status === 'loading' && list.data ? 'panel is-refreshing' : 'panel'}>
        {!list.data && list.status === 'loading' ? (
          <p className="muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 훈련생이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>성명</th>
                <th>생년월일</th>
                <th>연락처</th>
                <th>과정명</th>
                <th>확정일</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.enrollmentId}>
                  <td>
                    <Link to={`/trainees/${t.traineeId}?course_id=${t.courseId}`}>{t.name}</Link>
                  </td>
                  <td>{t.birthDate ?? '-'}</td>
                  <td>{t.contact ?? '-'}</td>
                  <td>{t.courseName}</td>
                  <td>{formatDateTime(t.confirmedAt)}</td>
                  <td>
                    <span className="badge badge-neutral">{label(ENROLLMENT_STATUS_LABELS, t.status)}</span>
                  </td>
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
