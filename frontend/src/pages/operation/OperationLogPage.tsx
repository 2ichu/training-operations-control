import { api } from '../../api/client'
import type { OperationLogRow } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useCourseOptions } from '../../api/useCourseOptions'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { formatDateTime, formatTime } from '../../format'
import { label, OPERATION_LOG_STATUS_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { OperationLogDialog } from './OperationLogDialog'

// S17 회차별 운영일지(system-design 7-A): 과정을 고르면 회차 목록과 작성 여부를 보여준다.
// "미작성"은 저장하지 않는 계산값(점선 배지)이며 대시보드·종료 체크리스트의 누락 건수와 같은 기준이다. 휴강 회차는 작성 대상이 아니다.
// 강사에게는 서버가 본인 회차만 준다. schedule_id 쿼리로 들어오면(S13 회차 클릭) 해당 회차를 바로 연다.
export function OperationLogPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const courseId = get('course_id')
  const courses = useCourseOptions()
  const query = { round_no: get('round_no'), from: get('from'), to: get('to') }
  const list = useApi(
    (signal) => (courseId ? api.get<{ items: OperationLogRow[] }>(`/courses/${courseId}/operation-logs`, query, signal).then((r) => r.items) : Promise.resolve(null)),
    `${courseId}:${JSON.stringify(query)}`,
  )
  const written = get('written')
  const rows = (list.data ?? []).filter((r) => !written || r.displayStatus === written)
  const openId = get('schedule_id')
  const open = list.data?.find((r) => String(r.scheduleId) === openId) ?? null

  return (
    <section className="page">
      <div className="page-header">
        <h1>회차별 운영일지</h1>
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          과정(필수)
          <select value={courseId} onChange={(e) => set({ course_id: e.target.value, schedule_id: undefined })}>
            <option value="">선택</option>
            {courses.data?.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.courseName}
              </option>
            ))}
          </select>
        </label>
        <label>
          회차
          <input type="number" min={1} value={get('round_no')} onChange={(e) => set({ round_no: e.target.value })} className="narrow" />
        </label>
        <label>
          교육일(부터)
          <input type="date" value={get('from')} onChange={(e) => set({ from: e.target.value })} />
        </label>
        <label>
          교육일(까지)
          <input type="date" value={get('to')} onChange={(e) => set({ to: e.target.value })} />
        </label>
        <label>
          작성여부
          <select value={written} onChange={(e) => set({ written: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(OPERATION_LOG_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </form>

      {!courseId && <EmptyText>과정을 선택해 주세요.</EmptyText>}
      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      {list.data && (
        <div className={list.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
          {rows.length === 0 ? (
            <EmptyText>조건에 맞는 회차가 없습니다.</EmptyText>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>회차</th>
                  <th>교육일</th>
                  <th>시간</th>
                  <th>강사</th>
                  <th>작성여부</th>
                  <th className="num">참여인원</th>
                  <th>작성일시</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.scheduleId}>
                    <td>{r.roundNo}회차</td>
                    <td>{r.classDate}</td>
                    <td>
                      {formatTime(r.startTime)}~{formatTime(r.endTime)}
                    </td>
                    <td>{r.instructorName}</td>
                    <td>
                      <LogStatusBadge status={r.displayStatus} />
                    </td>
                    <td className="num">{r.participantCount === null ? '-' : `${r.participantCount}명`}</td>
                    <td>{formatDateTime(r.writtenAt)}</td>
                    <td>
                      {r.displayStatus === 'WRITTEN' ? (
                        <button type="button" className="button-link" onClick={() => set({ schedule_id: String(r.scheduleId) }, { keepPage: true })}>
                          보기
                        </button>
                      ) : r.displayStatus === 'NOT_WRITTEN' && can('S17', 'C') ? (
                        <button type="button" className="button-link" onClick={() => set({ schedule_id: String(r.scheduleId) }, { keepPage: true })}>
                          작성
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {open && open.displayStatus !== null && (
        <OperationLogDialog key={open.scheduleId} courseId={courseId} row={open} onClose={() => set({ schedule_id: undefined }, { keepPage: true })} onSaved={list.reload} />
      )}
    </section>
  )
}

function LogStatusBadge({ status }: { status: OperationLogRow['displayStatus'] }) {
  if (status === null) return <span className="muted">휴강</span>
  return <span className={status === 'NOT_WRITTEN' ? 'badge badge-computed' : 'badge badge-neutral'}>{label(OPERATION_LOG_STATUS_LABELS, status)}</span>
}
