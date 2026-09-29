import { Link } from 'react-router'
import { api } from '../../api/client'
import type { SubmissionStatusRow } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { useUrlFilters } from '../../routing/useUrlFilters'

// S20 결과물 미제출(system-design 7-A): 결과물 행이 없는 확정 훈련생(계산상 미제출, C1). 조회 전용 — 독려 연락은 시스템 밖에서 하고
// 기록하지 않는다(B3). 제출기한·경과일수 열은 제출기한 저장 위치가 정해지지 않아(결정 #24) 보류한다. 등록은 S19 에서 한다.
export function MissingSubmissionPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const courses = useCourseOptions()
  const list = useApi(
    (signal) => (courseId ? api.get<{ items: SubmissionStatusRow[] }>(`/courses/${courseId}/submission-status`, { missing_only: 'true' }, signal).then((r) => r.items) : Promise.resolve(null)),
    courseId,
  )
  const courseName = courses.data?.find((c) => String(c.courseId) === courseId)?.courseName ?? ''
  const rows = list.data ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>결과물 미제출</h1>
        {courseId && can('S19', 'C') && <Link to={`/submissions?course_id=${courseId}`}>제출현황에서 등록하기</Link>}
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
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
      </form>
      <p className="hint">제출기한·경과일수는 제출기한 기준이 정해지면 표시합니다.</p>

      {!courseId && <EmptyText>과정을 선택해 주세요.</EmptyText>}
      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      {list.data && (
        <div className={list.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
          {rows.length === 0 ? (
            <EmptyText>미제출 훈련생이 없습니다.</EmptyText>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>훈련생명</th>
                  <th>과정</th>
                  <th>연락처</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.traineeId}>
                    <td>{can('S05', 'R') ? <Link to={`/trainees/${r.traineeId}?course_id=${courseId}`}>{r.traineeName}</Link> : r.traineeName}</td>
                    <td>{courseName}</td>
                    <td>{r.contact ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > 0 && <p className="muted">총 {rows.length}명</p>}
        </div>
      )}
    </section>
  )
}
