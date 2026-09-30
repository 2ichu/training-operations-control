import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { CourseSummary, DashboardSummary, RosterItem } from '../api/types'
import { useApi } from '../api/useApi'
import { useAuth, useCurrentUser } from '../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../components/Feedback'
import { CaseStatusBadge } from '../components/StatusBadge'
import { formatDateTime, formatTime, formatTrainees } from '../format'
import { ATTENDANCE_STATUS_LABELS, CASE_STATUS_LABELS, CASE_STATUS_ORDER, label, RULE_LABELS, SCHEDULE_STATUS_LABELS } from '../labels'

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
    (signal) => (canListCourses ? api.getAll<CourseSummary>('/courses', {}, signal) : Promise.resolve(null)),
    String(canListCourses),
  )

  // 공결 승인 대기 건수(S30 조회 권한이 있을 때만). 실패해도 대시보드는 그대로 보여 준다.
  const canExcuse = can('S30', 'R')
  const excusePending = useApi(
    (signal) => (canExcuse ? api.get<{ total: number }>('/excuse-requests', { status: 'PENDING', size: 1 }, signal).catch(() => null) : Promise.resolve(null)),
    String(canExcuse),
  )

  // 오늘 회차의 출결 현황(S07 조회 권한이 있을 때만). 회차별 명단을 받아 합산하고, 실패하면 이 도식만 숨긴다.
  const canRoster = can('S07', 'R')
  const attendanceToday = useApi(
    (signal) => {
      const list = (summary.data?.todaySchedules ?? []).filter((x) => x.status !== 'CANCELLED').slice(0, 8)
      if (!canRoster || list.length === 0) return Promise.resolve(null)
      return Promise.all(list.map((x) => api.get<{ items: RosterItem[] }>(`/schedules/${x.scheduleId}/attendance-roster`, undefined, signal).then((r) => r.items))).then((all) => all.flat()).catch(() => null)
    },
    `${canRoster}:${(summary.data?.todaySchedules ?? []).map((x) => x.scheduleId).join(',')}`,
  )

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const data = summary.data
  const byStatus = new Map(data?.verificationSummary.byStatus.map((s) => [s.status, s.count]) ?? [])
  const needsCheck = (byStatus.get('NEEDS_CHECK') ?? 0) + (byStatus.get('PRIORITY_CHECK') ?? 0)
  const actionRequired = (byStatus.get('ACTION_REQUIRED') ?? 0) + (byStatus.get('FOLLOW_UP') ?? 0)
  const dayParam = date || data?.date || ''

  // 처리할 업무 목록: 접근 권한이 있는 화면만 [확인하기] 링크로 연결한다. 확인/승인 건을 맨 앞에 두고, 0건인 항목도 목록에 남겨 점검표처럼 쓴다.
  const to = (screen: string, path: string) => (can(screen, 'R') ? path : null)
  const todo: { key: string; group: string; text: string; count: number; to: string | null; emphasis: boolean }[] = data
    ? [
        { key: 'needs', group: '확인·승인', text: '확인 필요 사항', count: needsCheck, to: to('S22', '/verification-cases?status=NEEDS_CHECK,PRIORITY_CHECK'), emphasis: true },
        { key: 'action', group: '확인·승인', text: '조치 필요·추가 확인 사항', count: actionRequired, to: to('S22', '/verification-cases?status=ACTION_REQUIRED,FOLLOW_UP'), emphasis: true },
        { key: 'excuse', group: '확인·승인', text: '공결 승인 대기', count: excusePending.data?.total ?? 0, to: canExcuse ? '/excuse-requests' : null, emphasis: true },
        { key: 'att', group: '출결', text: '미출결', count: data.counts.notCheckedIn, to: to('S07', `/attendance/daily?date=${dayParam}`), emphasis: false },
        { key: 'out', group: '출결', text: '퇴실 미확인', count: data.counts.checkoutMissing, to: to('S07', `/attendance/daily?date=${dayParam}`), emphasis: false },
        { key: 'log', group: '운영', text: '운영일지 미작성', count: data.counts.operationLogMissing, to: to('S17', '/operation-logs'), emphasis: false },
        { key: 'sub', group: '결과물', text: '결과물 미제출', count: data.counts.submissionMissing, to: to('S19', '/submissions/missing'), emphasis: false },
        { key: 'rev', group: '결과물', text: '결과물 미검토', count: data.counts.reviewPending, to: to('S19', '/submissions'), emphasis: false },
      ]
    : []

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
      {!data && summary.status === 'loading' && <Loading />}

      {data && (
        <div className={summary.status === 'loading' ? 'dashboard is-refreshing' : 'dashboard'}>
          <section className="dash-todo" aria-labelledby="todo-title">
            <h2 id="todo-title">처리할 업무</h2>
            <p className="hint">종료되지 않은 과정 전체 기준, 현재 시점 집계(날짜 필터 미적용). 확인 필요 건은 기간과 무관하게 진행 중인 전체입니다.</p>
            <table className="todo">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>업무</th>
                  <th className="num">건수</th>
                  <th>상태</th>
                  <th>처리</th>
                </tr>
              </thead>
              <tbody>
                {todo.map((t, i) => (
                  <tr key={t.key} className={t.count > 0 ? undefined : 'zero'}>
                    <td className="group">{i === 0 || todo[i - 1].group !== t.group ? t.group : ''}</td>
                    <th scope="row">{t.text}</th>
                    <td className="num">{t.count}</td>
                    <td>{t.count > 0 ? <span className={t.emphasis ? 'badge badge-attention' : 'badge badge-neutral'}>{t.emphasis ? '확인 필요' : '미처리'}</span> : ''}</td>
                    <td>{t.count > 0 && t.to ? <Link to={t.to}>확인하기</Link> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="dash-today" aria-labelledby="today-title">
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
                      <td>{label(SCHEDULE_STATUS_LABELS, s.displayStatus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {attendanceToday.data && attendanceToday.data.length > 0 && <AttendanceToday roster={attendanceToday.data} />}
          </section>

          <section className="dash-cases" aria-labelledby="case-title">
            <h2 id="case-title">확인 필요 사항</h2>
            <div className="case-overview">
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

              <div className="case-recent">
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
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}

// 오늘 회차 출결 요약: 회차별 명단을 합산한 한 줄 텍스트(휴강 회차 제외)
function AttendanceToday({ roster }: { roster: RosterItem[] }) {
  const order = ['PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED', 'NOT_CHECKED']
  const counts = new Map<string, number>()
  for (const r of roster) if (r.displayStatus) counts.set(r.displayStatus, (counts.get(r.displayStatus) ?? 0) + 1)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  return (
    <p className="att-summary">
      <span className="muted">출결 현황</span> 전체 {total}명 ·{' '}
      {order.map((k, i) => (
        <span key={k}>
          {i > 0 && ' · '}
          {label(ATTENDANCE_STATUS_LABELS, k)} {counts.get(k) ?? 0}
        </span>
      ))}
    </p>
  )
}
