import { Link } from 'react-router'
import { api } from '../../api/client'
import type { SubmissionStatusRow } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { ReviewStatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../format'
import { REVIEW_STATUS_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

// 결과물 관리 > 검토이력(S21 진입 목록): 과정의 등록된 결과물을 검토상태별로 모아 본다(기본 = 대기). 행 → S21 상세·검토.
// 제출현황(S19) API 를 검토상태로 걸러 재사용한다(미제출 행은 결과물이 없어 제외).
export function SubmissionReviewListPage() {
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const status = get('review_status') || 'PENDING'
  const courses = useCourseOptions()
  const list = useApi(
    (signal) =>
      courseId
        ? api.get<{ items: SubmissionStatusRow[] }>(`/courses/${courseId}/submission-status`, { review_status: status === 'ALL' ? undefined : status }, signal).then((r) => r.items.filter((i) => i.submissionId !== null))
        : Promise.resolve(null),
    `${courseId}:${status}`,
  )
  const rows = list.data ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>검토이력</h1>
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
        <label>
          검토상태
          <select value={status} onChange={(e) => set({ review_status: e.target.value === 'PENDING' ? undefined : e.target.value })}>
            {Object.entries(REVIEW_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
            <option value="ALL">전체</option>
          </select>
        </label>
      </form>

      {!courseId && <EmptyText>과정을 선택해 주세요.</EmptyText>}
      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      {list.data && (
        <div className={list.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
          {rows.length === 0 ? (
            <EmptyText>조건에 맞는 결과물이 없습니다.</EmptyText>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>훈련생명</th>
                  <th>제목</th>
                  <th className="num">버전</th>
                  <th>제출일</th>
                  <th>검토상태</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.submissionId}>
                    <td>{r.traineeName}</td>
                    <td>
                      <Link to={`/submissions/${r.submissionId}`}>{r.title}</Link>
                    </td>
                    <td className="num">v{r.version}</td>
                    <td>{formatDateTime(r.submittedAt)}</td>
                    <td>{r.reviewStatus && <ReviewStatusBadge status={r.reviewStatus} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
