import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api } from '../api/client'
import type { CourseSummary, DashboardRecentCase, DashboardSummary, RosterItem } from '../api/types'
import { useApi } from '../api/useApi'
import { useAuth, useCurrentUser } from '../auth/auth-context'
import { Bar, Gauge } from '../components/Charts'
import { EmptyText, ErrorText, Loading } from '../components/Feedback'
import { CaseStatusBadge } from '../components/StatusBadge'
import { formatDateTime, formatTime, formatTrainees } from '../format'
import { ATTENDANCE_STATUS_LABELS, label, RULE_LABELS, SCHEDULE_STATUS_LABELS } from '../labels'

// 도식 색: 색만으로 구분하지 않도록 항상 텍스트(범례·표)를 함께 표시한다. 채도를 낮춰 쓰고, 노랑=확인 필요, 주황=조치·지각·조퇴, 빨강=결석, 파랑=확인 중·인정결석, 초록=정상·완료
const ATTENDANCE_COLORS: Record<string, string> = { PRESENT: '#5a9a6e', LATE: '#c98a3a', EARLY_LEAVE: '#d9ac66', ABSENT: '#c0524a', EXCUSED: '#5b7db1', NOT_CHECKED: '#a8afba' }

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
  // 상단 브리핑: 오늘 처리할 업무 총건수 + 업무별 구성 막대(각 구간은 해당 화면 링크)
  const rosterAll = attendanceToday.data ?? []
  const rosterTotal = rosterAll.filter((r) => r.displayStatus).length
  const rosterDone = rosterAll.filter((r) => r.displayStatus && r.displayStatus !== 'NOT_CHECKED').length
  const BRIEF_COLORS: Record<string, string> = { needs: '#d99a00', action: '#e8b94a', excuse: '#f0d078', att: '#c9683a', out: '#dc8f66', log: '#5f7396', sub: '#8d99ad', rev: '#b8c0cd' }
  const openTotal = todo.reduce((sum, t) => sum + t.count, 0)
  const topTask = todo.length > 0 ? todo.reduce((m, t) => (t.count > m.count ? t : m), todo[0]) : null

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
          <section className="brief" aria-label="주요 현황">
            <div className="brief-head">
              <div className="brief-total">
                <span className="brief-caption">처리할 업무</span>
                <span className="brief-number">
                  {openTotal}
                  <span className="brief-unit">건</span>
                </span>
              </div>
              <ul className="brief-facts">
                <li>
                  <span>확인 필요</span>
                  <strong className={needsCheck > 0 ? 'fact-alert' : undefined}>{needsCheck}건</strong>
                </li>
                <li>
                  <span>오늘 수업</span>
                  <strong>{data.todaySchedules.length}건</strong>
                </li>
                <li>
                  <span>미출결</span>
                  <strong>{data.counts.notCheckedIn}건</strong>
                </li>
                <li>
                  <span>운영일지 미작성</span>
                  <strong>{data.counts.operationLogMissing}건</strong>
                </li>
                {rosterTotal > 0 && (
                  <li>
                    <span>출결 입력</span>
                    <strong>
                      {rosterDone}/{rosterTotal}명
                    </strong>
                  </li>
                )}
              </ul>
            </div>
            {openTotal > 0 && (
              <>
                <div className="brief-bar" aria-hidden="true">
                  {todo
                    .filter((t) => t.count > 0)
                    .map((t) => (
                      <span key={t.key} style={{ flex: t.count, background: BRIEF_COLORS[t.key] }} />
                    ))}
                </div>
                <ul className="brief-legend">
                  {todo
                    .filter((t) => t.count > 0)
                    .map((t) => (
                      <li key={t.key}>
                        <span className="swatch" aria-hidden="true" style={{ background: BRIEF_COLORS[t.key] }} />
                        {t.to ? <Link to={t.to}>{t.text}</Link> : t.text} <strong>{t.count}</strong>
                      </li>
                    ))}
                </ul>
              </>
            )}
            {topTask && topTask.count > 0 && (
              <p className="brief-note">
                가장 많은 업무는 <strong>{topTask.text}</strong> {topTask.count}건입니다.
              </p>
            )}
          </section>

          <section className="dash-todo" aria-labelledby="todo-title">
            <h2 id="todo-title">처리할 업무</h2>
            <table className="todo">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>업무</th>
                  <th className="num">건수</th>
                  <th>상태</th>
                  <th className="bar-col">비중</th>
                  <th>처리</th>
                </tr>
              </thead>
              <tbody>
                {todo.map((t, i) => (
                  <tr key={t.key} className={[t.count > 0 ? '' : 'zero', i === 0 || todo[i - 1].group !== t.group ? 'group-start' : ''].filter(Boolean).join(' ') || undefined}>
                    <td className="group">{i === 0 || todo[i - 1].group !== t.group ? t.group : ''}</td>
                    <th scope="row">{t.text}</th>
                    <td className="num">{t.count}</td>
                    <td>{t.count > 0 ? <span className={t.emphasis ? 'badge badge-attention' : 'badge badge-neutral'}>{t.emphasis ? '확인 필요' : '미처리'}</span> : ''}</td>
                    <td className="bar-col">{t.count > 0 && <Bar value={t.count} max={Math.max(1, ...todo.map((x) => x.count))} color={t.emphasis ? '#d1a63a' : '#a8afba'} />}</td>
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
              <ul className="session-list">
                {data.todaySchedules.map((s) => (
                  <li key={s.scheduleId}>
                    {canOpenCourse ? <Link to={`/courses/${s.courseId}`}>{s.courseName}</Link> : <span className="session-name">{s.courseName}</span>}
                    <span className="session-meta">
                      <strong>{s.roundNo}회차</strong> {formatTime(s.startTime)}~{formatTime(s.endTime)} · {s.instructorName ?? '-'} · {label(SCHEDULE_STATUS_LABELS, s.displayStatus)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {attendanceToday.data && attendanceToday.data.length > 0 && <AttendanceToday roster={attendanceToday.data} />}
          </section>

          <section className="dash-cases" aria-labelledby="case-title">
            <h2 id="case-title">확인 필요 사항</h2>
            <div className="case-recent">
              {data.verificationSummary.recent.length === 0 ? (
                <EmptyText>확인이 필요한 건이 없습니다.</EmptyText>
              ) : (
                <RecentCases cases={data.verificationSummary.recent} canOpenCase={canOpenCase} onOpen={(id) => navigate(`/verification-cases/${id}`)} />
              )}
              </div>
          </section>
        </div>
      )}
    </section>
  )
}

// 오늘 회차 출결 현황: 회차별 명단을 합산한 도넛 + 범례(휴강 회차 제외)
function AttendanceToday({ roster }: { roster: RosterItem[] }) {
  const order = ['PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED', 'NOT_CHECKED']
  const counts = new Map<string, number>()
  for (const r of roster) if (r.displayStatus) counts.set(r.displayStatus, (counts.get(r.displayStatus) ?? 0) + 1)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)
  const done = total - (counts.get('NOT_CHECKED') ?? 0)
  return (
    <div className="att-today">
      <h3>오늘 출결 현황 <span className="muted">(입력 {done}/{total}명)</span></h3>
      <div className="att-donut">
        <Gauge value={total === 0 ? 0 : done / total} label="출결 입력률" width={210} />
        <ul className="att-legend">
          {order.map((k) => (
            <li key={k}>
              <span className="att-name">
                <span className="swatch" aria-hidden="true" style={{ background: ATTENDANCE_COLORS[k] }} />
                {label(ATTENDANCE_STATUS_LABELS, k)}
              </span>
              <Bar value={counts.get(k) ?? 0} max={Math.max(1, total)} color={ATTENDANCE_COLORS[k]} />
              <strong>{counts.get(k) ?? 0}명</strong>
              <span className="att-pct">{total === 0 ? '-' : `${Math.round(((counts.get(k) ?? 0) / total) * 100)}%`}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// 최근 발생 건: 같은 발생일시(분 단위)·같은 과정의 건은 대표 한 줄("과정명 외 N건")로 묶고, 눌러서 펼치면 개별 건을 보여 준다.
function RecentCases({ cases, canOpenCase, onOpen }: { cases: DashboardRecentCase[]; canOpenCase: boolean; onOpen: (caseId: number) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const groups = new Map<string, DashboardRecentCase[]>()
  for (const c of cases) {
    const key = `${formatDateTime(c.detectedAt)}|${c.courseId}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const same = <T,>(values: T[]) => values.every((v) => v === values[0])

  const caseRow = (c: DashboardRecentCase, child = false) => (
    <tr key={c.caseId} className={[canOpenCase ? 'clickable' : '', child ? 'child-row' : ''].filter(Boolean).join(' ') || undefined} onClick={canOpenCase ? () => onOpen(c.caseId) : undefined}>
      <td>{canOpenCase ? <Link to={`/verification-cases/${c.caseId}`}>{formatDateTime(c.detectedAt)}</Link> : formatDateTime(c.detectedAt)}</td>
      <td>{c.courseName}</td>
      <td>{formatTrainees(c.trainees.map((t) => t.name))}</td>
      <td>{label(RULE_LABELS, c.ruleCode)}</td>
      <td>
        <CaseStatusBadge status={c.status} />
      </td>
      <td>{c.assigneeName ?? '미지정'}</td>
    </tr>
  )

  return (
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
        {[...groups.entries()].map(([key, list]) => {
          if (list.length === 1) return caseRow(list[0])
          const expanded = open.has(key)
          const head = list[0]
          const trainees = new Set(list.flatMap((c) => c.trainees.map((t) => t.name)))
          return [
            <tr key={key} className="group-row clickable" onClick={() => toggle(key)}>
              <td>
                <button type="button" className="row-toggle" aria-expanded={expanded} aria-label={`${head.courseName} 외 ${list.length - 1}건 ${expanded ? '접기' : '펼치기'}`} onClick={(e) => { e.stopPropagation(); toggle(key) }}>
                  <span className="row-chevron" aria-hidden="true" />
                  {formatDateTime(head.detectedAt)}
                </button>
              </td>
              <td>
                <strong>{head.courseName}</strong> <span className="group-count">외 {list.length - 1}건</span>
              </td>
              <td>{trainees.size > 0 ? `${trainees.size}명` : '-'}</td>
              <td>{same(list.map((c) => c.ruleCode)) ? label(RULE_LABELS, head.ruleCode) : `${new Set(list.map((c) => c.ruleCode)).size}개 유형`}</td>
              <td>{same(list.map((c) => c.status)) ? <CaseStatusBadge status={head.status} /> : <span className="muted">복수</span>}</td>
              <td>{same(list.map((c) => c.assigneeName ?? '')) ? (head.assigneeName ?? '미지정') : '복수'}</td>
            </tr>,
            ...(expanded ? list.map((c) => caseRow(c, true)) : []),
          ]
        })}
      </tbody>
    </table>
  )
}
