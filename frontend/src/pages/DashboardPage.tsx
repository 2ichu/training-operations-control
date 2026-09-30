import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { CourseSummary, DashboardSummary } from '../api/types'
import { useApi } from '../api/useApi'
import { useAuth, useCurrentUser } from '../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../components/Feedback'
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
    (signal) => (canListCourses ? api.getAll<CourseSummary>('/courses', {}, signal) : Promise.resolve(null)),
    String(canListCourses),
  )

  // 공결 승인 대기 건수(S30 조회 권한이 있을 때만). 실패해도 대시보드는 그대로 보여 준다.
  const canExcuse = can('S30', 'R')
  const excusePending = useApi(
    (signal) => (canExcuse ? api.get<{ total: number }>('/excuse-requests', { status: 'PENDING', size: 1 }, signal).catch(() => null) : Promise.resolve(null)),
    String(canExcuse),
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

  // 처리할 일: 화면 접근 권한이 있는 항목만 링크로 연결한다. 확인/조치 사항을 맨 앞에 둔다.
  const todo: { key: string; text: string; count: number; to: string | null; tone: 'attention' | 'action' | 'muted' }[] = data
    ? [
        { key: 'needs', text: '확인 필요 사항', count: needsCheck, to: can('S22', 'R') ? '/verification-cases?status=NEEDS_CHECK,PRIORITY_CHECK' : null, tone: 'attention' },
        { key: 'action', text: '조치 필요·추가 확인 사항', count: actionRequired, to: can('S22', 'R') ? '/verification-cases?status=ACTION_REQUIRED,FOLLOW_UP' : null, tone: 'action' },
        { key: 'excuse', text: '공결 승인 대기', count: excusePending.data?.total ?? 0, to: canExcuse ? '/excuse-requests' : null, tone: 'attention' },
        { key: 'att', text: '출결 미입력 훈련생', count: data.counts.notCheckedIn, to: can('S07', 'R') ? `/attendance/daily?date=${dayParam}` : null, tone: 'muted' },
        { key: 'out', text: '퇴실 미확인', count: data.counts.checkoutMissing, to: can('S07', 'R') ? `/attendance/daily?date=${dayParam}` : null, tone: 'muted' },
        { key: 'log', text: '운영일지 미작성 회차', count: data.counts.operationLogMissing, to: can('S17', 'R') ? '/operation-logs' : null, tone: 'muted' },
        { key: 'sub', text: '결과물 미제출', count: data.counts.submissionMissing, to: can('S19', 'R') ? '/submissions/missing' : null, tone: 'muted' },
        { key: 'rev', text: '결과물 미검토', count: data.counts.reviewPending, to: can('S19', 'R') ? '/submissions' : null, tone: 'muted' },
      ]
    : []
  const kpis: { key: string; text: string; value: number; to: string | null; tone: string }[] = data
    ? [
        { key: 'today', text: '오늘 수업', value: data.todaySchedules.length, to: null, tone: '' },
        { key: 'needs', text: '확인 필요', value: needsCheck, to: todo[0].to, tone: needsCheck > 0 ? 'attention' : '' },
        { key: 'att', text: '미출결', value: data.counts.notCheckedIn, to: todo[3].to, tone: '' },
        { key: 'log', text: '운영일지 미작성', value: data.counts.operationLogMissing, to: todo[5].to, tone: '' },
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
          <ul className="kpi-strip panel-wide" aria-label="주요 현황">
            {kpis.map((k) => (
              <li key={k.key} className={k.tone ? `kpi kpi-${k.tone}` : 'kpi'}>
                {k.to ? (
                  <Link to={k.to}>
                    <span className="kpi-label">{k.text}</span>
                    <span className="kpi-value">{k.value}건</span>
                  </Link>
                ) : (
                  <div>
                    <span className="kpi-label">{k.text}</span>
                    <span className="kpi-value">{k.value}건</span>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <section className="panel panel-wide" aria-labelledby="todo-title">
            <h2 id="todo-title">처리할 일</h2>
            {todo.every((t) => t.count === 0) ? (
              <EmptyText>처리할 일이 없습니다.</EmptyText>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>구분</th>
                    <th className="num">건수</th>
                    <th>처리</th>
                  </tr>
                </thead>
                <tbody>
                  {todo
                    .filter((t) => t.count > 0)
                    .map((t) => (
                      <tr key={t.key}>
                        <td>
                          <span className={`badge badge-${t.tone}`}>{t.text}</span>
                        </td>
                        <td className="num">{t.count}건</td>
                        <td>{t.to ? <Link to={t.to}>[확인하기]</Link> : <span className="muted">-</span>}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>

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
                      <td>{label(SCHEDULE_STATUS_LABELS, s.displayStatus)}</td>
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
