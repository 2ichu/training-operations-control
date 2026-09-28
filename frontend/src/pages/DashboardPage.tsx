import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { CourseSummary, DashboardSummary, Paged } from '../api/types'
import { useApi } from '../api/useApi'
import { useAuth, useCurrentUser } from '../auth/auth-context'
import { EmptyText, ErrorText } from '../components/Feedback'
import { CaseStatusBadge } from '../components/StatusBadge'
import { formatDateTime, formatTime, formatTrainees } from '../format'
import { CASE_STATUS_LABELS, CASE_STATUS_ORDER, label, RULE_LABELS, SCHEDULE_STATUS_LABELS } from '../labels'

// 대시보드 집계 건수(backend dashboard.service aggregateCounts — 종료 체크리스트 항목 1·2·4·5·6 합산)
const COUNT_ROWS: { key: keyof DashboardSummary['counts']; label: string }[] = [
  { key: 'notCheckedIn', label: '미출결' },
  { key: 'checkoutMissing', label: '퇴실 미확인' },
  { key: 'operationLogMissing', label: '운영일지 미작성' },
  { key: 'submissionMissing', label: '결과물 미제출' },
  { key: 'reviewPending', label: '결과물 미검토' },
]

// S01 대시보드(system-design 7.1). 조회 전용이며 역할별 범위는 서버가 정한다(INSTRUCTOR 는 본인 과정만).
// 필터(날짜·과정·담당)는 URL 쿼리에 두어 새로고침·공유 시에도 유지된다.
export function DashboardPage() {
  const { can } = useAuth()
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const date = params.get('date') ?? ''
  const courseId = params.get('course_id') ?? ''
  const mine = params.get('mine') === '1'
  // 담당자 필터: 사용자 목록 조회(S25)는 시스템 관리자 전용이라, 확인/조치를 처리하는 역할에 "내 담당만" 으로 제공한다
  const canHandleCases = can('S22', 'A')
  const canOpenCase = can('S23', 'R')
  const canOpenCourse = can('S16', 'R')

  const query = { date, course_id: courseId, assignee_id: mine && canHandleCases ? user.userId : undefined }
  const summary = useApi((signal) => api.get<DashboardSummary>('/dashboard', query, signal), JSON.stringify(query))
  // 과정 필터 목록(S15 조회 권한이 있을 때만). 서버가 역할별 범위(강사는 본인 배정 과정)로 걸러 준다.
  const canListCourses = can('S15', 'R')
  const courses = useApi(
    (signal) => (canListCourses ? api.get<Paged<CourseSummary>>('/courses', { size: 100 }, signal) : Promise.resolve(null)),
    String(canListCourses),
  )

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const data = summary.data
  const byStatus = new Map(data?.verificationSummary.byStatus.map((s) => [s.status, s.count]) ?? [])

  return (
    <section className="page">
      <div className="page-header">
        <h1>대시보드</h1>
        <form className="filters" onSubmit={(e) => e.preventDefault()}>
          <label>
            날짜
            <input type="date" value={date || data?.date || ''} onChange={(e) => setParam('date', e.target.value)} />
          </label>
          <label>
            과정
            <select value={courseId} onChange={(e) => setParam('course_id', e.target.value)}>
              <option value="">전체</option>
              {courses.data?.items.map((c) => (
                <option key={c.courseId} value={c.courseId}>
                  {c.courseName}
                </option>
              ))}
            </select>
          </label>
          {canHandleCases && (
            <label className="checkbox">
              <input type="checkbox" checked={mine} onChange={(e) => setParam('mine', e.target.checked ? '1' : '')} />내 담당 건만
            </label>
          )}
        </form>
      </div>

      {summary.status === 'error' && <ErrorText error={summary.error} onRetry={summary.reload} />}
      {!data && summary.status === 'loading' && <p className="muted">불러오는 중…</p>}

      {data && (
        <div className={summary.status === 'loading' ? 'dashboard is-refreshing' : 'dashboard'}>
          <section className="panel panel-wide" aria-labelledby="today-title">
            <h2 id="today-title">{data.date} 회차</h2>
            {data.todaySchedules.length === 0 ? (
              <EmptyText>{date ? '해당 날짜에 예정된 교육이 없습니다.' : '오늘 예정된 교육이 없습니다.'}</EmptyText>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>과정</th>
                    <th>회차</th>
                    <th>시간</th>
                    <th>강사</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {data.todaySchedules.map((s) => (
                    <tr key={s.scheduleId} className={canOpenCourse ? 'clickable' : undefined} onClick={canOpenCourse ? () => navigate(`/courses/${s.courseId}`) : undefined}>
                      <td>{canOpenCourse ? <Link to={`/courses/${s.courseId}`}>{s.courseName}</Link> : s.courseName}</td>
                      <td>{s.roundNo}회차</td>
                      <td>
                        {formatTime(s.startTime)}~{formatTime(s.endTime)}
                      </td>
                      <td>{s.instructorName ?? '-'}</td>
                      <td>{label(SCHEDULE_STATUS_LABELS, s.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel" aria-labelledby="case-title">
            <h2 id="case-title">확인 필요 사항</h2>
            <table className="compact">
              <thead>
                <tr>
                  <th>상태</th>
                  <th className="num">건수</th>
                </tr>
              </thead>
              <tbody>
                {CASE_STATUS_ORDER.map((status) => (
                  <tr key={status}>
                    <td>{label(CASE_STATUS_LABELS, status)}</td>
                    <td className="num">{byStatus.get(status) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>최근 발생 건</h3>
            {data.verificationSummary.recent.length === 0 ? (
              <EmptyText>확인이 필요한 건이 없습니다.</EmptyText>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>발생일시</th>
                    <th>과정</th>
                    <th>대상</th>
                    <th>탐지유형</th>
                    <th>상태</th>
                    <th>담당자</th>
                  </tr>
                </thead>
                <tbody>
                  {data.verificationSummary.recent.map((c) => (
                    <tr key={c.caseId} className={canOpenCase ? 'clickable' : undefined} onClick={canOpenCase ? () => navigate(`/verification-cases/${c.caseId}`) : undefined}>
                      <td>{canOpenCase ? <Link to={`/verification-cases/${c.caseId}`}>{formatDateTime(c.detectedAt)}</Link> : formatDateTime(c.detectedAt)}</td>
                      <td>{c.courseName}</td>
                      <td>{formatTrainees(c.trainees.map((t) => t.name))}</td>
                      <td>{label(RULE_LABELS, c.ruleCode)}</td>
                      <td>
                        <CaseStatusBadge status={c.status} />
                      </td>
                      <td>{c.assigneeName ?? '미지정'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="panel" aria-labelledby="pending-title">
            <h2 id="pending-title">미처리 현황</h2>
            <p className="hint">종료되지 않은 과정 전체 기준, 현재 시점 집계(날짜 필터 미적용)</p>
            <table className="compact">
              <tbody>
                {COUNT_ROWS.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td className="num">{data.counts[row.key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </section>
  )
}
