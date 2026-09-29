import { Link } from 'react-router'
import { api } from '../../api/client'
import type { SubmissionStatusResponse } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { SubmitStatusBadge } from '../../components/StatusBadge'
import { useUrlFilters } from '../../routing/useUrlFilters'

// S20 결과물 미제출(system-design 7-A): 결과물이 없는 확정 훈련생(계산상 미제출, C1) + 기한후제출. 조회 전용 — 독려 연락은
// 시스템 밖에서 하고 기록하지 않는다(B3). 제출기한은 과정 공통(D-04), 경과일수는 미제출=오늘-기한, 기한후제출=제출일-기한.
// 등록은 S19 에서 한다.
export function MissingSubmissionPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const courses = useCourseOptions()
  const list = useApi(
    (signal) => (courseId ? api.get<SubmissionStatusResponse>(`/courses/${courseId}/submission-status`, { missing_or_late: 'true' }, signal) : Promise.resolve(null)),
    courseId,
  )
  const courseName = courses.data?.find((c) => String(c.courseId) === courseId)?.courseName ?? ''
  const rows = list.data?.items ?? []
  const due = list.data?.submissionDueDate ?? null

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
      {list.data && due === null && <p className="hint">이 과정에는 결과물 제출기한이 없습니다. 과정 상세에서 정하면 경과일수와 기한후제출이 표시됩니다.</p>}

      {!courseId && <EmptyText>과정을 선택해 주세요.</EmptyText>}
      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      {list.data && (
        <div className={list.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
          {rows.length === 0 ? (
            <EmptyText>미제출·기한후제출 훈련생이 없습니다.</EmptyText>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>훈련생명</th>
                  <th>과정</th>
                  <th>상태</th>
                  <th>제출기한</th>
                  <th className="num">경과일수</th>
                  <th>연락처</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.traineeId}:${r.submissionId ?? 'none'}`}>
                    <td>{can('S05', 'R') ? <Link to={`/trainees/${r.traineeId}?course_id=${courseId}`}>{r.traineeName}</Link> : r.traineeName}</td>
                    <td>{courseName}</td>
                    <td>
                      <SubmitStatusBadge status={r.displayStatus} />
                      {r.title && <span className="muted"> {r.title}</span>}
                    </td>
                    <td>{due ?? '-'}</td>
                    <td className="num">{r.overdueDays === null ? '-' : `${r.overdueDays}일`}</td>
                    <td>{r.contact ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows.length > 0 && <p className="muted">총 {rows.length}건</p>}
        </div>
      )}
    </section>
  )
}
