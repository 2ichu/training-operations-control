import { useState } from 'react'
import { Link } from 'react-router'
import { api } from '../../api/client'
import type { CompletionCandidates, EnrollmentListItem, Paged } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { formatDateTime } from '../../format'
import { ENROLLMENT_STATUS_LABELS, label } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { EnrollmentActionDialog } from './EnrollmentActionDialog'
import { ACTIONS_BY_STATUS, ENROLLMENT_ACTIONS, ENROLLMENT_TABS, type EnrollmentAction } from './enrollment-model'

const PAGE_SIZE = 20

// S02 대상자 확인(system-design 7-A): 등록 건을 상태 탭으로 나눠 보고, 운영담당자(S02:U)가 확인 착수·확정·반려,
// 확정 이후 수료·중도포기·제적을 처리한다. 과정을 고르고 확정 탭을 보면 수료 판정 후보(D-05 §6)를 함께 보여준다.
export function EnrollmentReviewPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const canUpdate = can('S02', 'U')
  const tab = ENROLLMENT_TABS.find((t) => t.key === get('tab')) ?? ENROLLMENT_TABS[0]
  const page = Number(get('page')) || 1
  const courseId = get('course_id')
  const query = { status: tab.statuses.join(','), course_id: courseId, name: get('name'), applied_from: get('from'), applied_to: get('to'), page, size: PAGE_SIZE }
  const list = useApi((signal) => api.get<Paged<EnrollmentListItem>>('/enrollments', query, signal), JSON.stringify(query))
  const courses = useCourseOptions()
  const [name, setName] = useState(get('name'))
  const [acting, setActing] = useState<{ item: EnrollmentListItem; action: EnrollmentAction } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const items = list.data?.items ?? []

  return (
    <section className="page">
      <div className="page-header">
        <h1>대상자 확인</h1>
        {can('S04', 'C') && (
          <Link className="button button-primary" to="/trainees/new">
            훈련생 등록
          </Link>
        )}
      </div>

      <div className="tabs" role="tablist" aria-label="등록 상태">
        {ENROLLMENT_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === tab.key} className={t.key === tab.key ? 'tab active' : 'tab'} onClick={() => set({ tab: t.key === 'review' ? undefined : t.key })}>
            {t.label}
          </button>
        ))}
      </div>

      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ name: name.trim() || undefined })
        }}
      >
        <label>
          과정
          <select value={courseId} onChange={(e) => set({ course_id: e.target.value })}>
            <option value="">전체</option>
            {courses.data?.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          성명
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <button type="submit">검색</button>
        <label>
          신청일(부터)
          <input type="date" value={get('from')} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          신청일(까지)
          <input type="date" value={get('to')} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <button type="button" onClick={list.reload}>
          새로고침
        </button>
      </form>

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {tab.key === 'confirmed' && courseId && <CompletionCandidatesPanel courseId={Number(courseId)} />}

      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className={list.status === 'loading' && list.data ? 'panel is-refreshing' : 'panel'}>
        {!list.data && list.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 등록 건이 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>성명</th>
                <th>생년월일</th>
                <th>과정명</th>
                <th>신청일</th>
                <th>상태</th>
                {tab.key === 'cancelled' && <th>취소 사유</th>}
                {canUpdate && <th>처리</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.enrollmentId}>
                  <td>
                    <Link to={`/trainees/${e.traineeId}?course_id=${e.courseId}`}>{e.name}</Link>
                  </td>
                  <td>{e.birthDate ?? '-'}</td>
                  <td>{e.courseName}</td>
                  <td>{formatDateTime(e.appliedAt)}</td>
                  <td>
                    <span className="badge badge-neutral">{label(ENROLLMENT_STATUS_LABELS, e.status)}</span>
                  </td>
                  {tab.key === 'cancelled' && <td className="wrap">{e.cancelReason ?? '-'}</td>}
                  {canUpdate && (
                    <td className="row-actions">
                      {(ACTIONS_BY_STATUS[e.status] ?? []).map((action) => (
                        <button key={action} type="button" onClick={() => setActing({ item: e, action })}>
                          {ENROLLMENT_ACTIONS[action].label}
                        </button>
                      ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data && list.data.total > 0 && <Pagination page={list.data.page} size={list.data.size} total={list.data.total} onChange={(p) => set({ page: String(p) })} />}

      {acting && (
        <EnrollmentActionDialog
          enrollment={acting.item}
          action={acting.action}
          onClose={() => setActing(null)}
          onDone={(text) => {
            setActing(null)
            setMessage(text)
            list.reload()
          }}
        />
      )}
    </section>
  )
}

// D-05 §6: 마지막 회차 종료 후 출석률이 기준 미달인 확정 훈련생을 "확인 필요 후보"로만 보여준다.
// 시스템은 판정하지 않고, 최종 처리는 사람이 위 목록의 수료·중도포기·제적으로 한다.
function CompletionCandidatesPanel({ courseId }: { courseId: number }) {
  const result = useApi((signal) => api.get<CompletionCandidates>(`/courses/${courseId}/completion-candidates`, undefined, signal), String(courseId))
  if (result.status === 'error') return <ErrorText error={result.error} onRetry={result.reload} />
  const data = result.data
  if (!data) return null
  return (
    <section className="panel" aria-labelledby="candidates-title">
      <h2 id="candidates-title">수료 판정 확인 후보</h2>
      {!data.ready ? (
        <EmptyText>마지막 회차가 끝난 뒤에 계산합니다.</EmptyText>
      ) : data.items.length === 0 ? (
        <EmptyText>출석률 {Math.round(data.threshold * 100)}% 미만인 확정 훈련생이 없습니다.</EmptyText>
      ) : (
        <>
          <p className="hint">
            출석률(출석·지각·조퇴·인정결석 일수에서 지각·조퇴 {data.lateToAbsence}회당 결석 1일을 뺀 값, 휴강 제외)이 {Math.round(data.threshold * 100)}% 미만인 훈련생입니다. 시스템은 판정하지 않으며, 처리는 담당자가 합니다.
          </p>
          <table className="compact">
            <thead>
              <tr>
                <th>성명</th>
                <th className="num">출석률</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.enrollmentId}>
                  <td>
                    <Link to={`/trainees/${c.traineeId}?course_id=${courseId}`}>{c.name}</Link>
                  </td>
                  <td className="num">{(c.attendanceRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
