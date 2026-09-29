import { Link } from 'react-router'
import type { ScheduleListItem } from '../../api/types'
import { formatTime } from '../../format'
import { SCHEDULE_STATUS_LABELS, label } from '../../labels'
import { calendarWeeks } from './schedule-model'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const eventText = (s: ScheduleListItem) =>
  `${formatTime(s.startTime)} ${s.courseName} ${s.roundNo}회차 · ${s.instructorName}${s.displayStatus !== 'SCHEDULED' ? ` (${label(SCHEDULE_STATUS_LABELS, s.displayStatus)})` : ''}`

// S13 캘린더 뷰(강사 진입 기본). 월 단위, 일요일 시작. 좁은 화면에서는 일정이 있는 날만 세로 목록으로 보인다(CSS).
export function ScheduleCalendar({ month, items, today, linkToLog = false }: { month: string; items: ScheduleListItem[]; today: string; linkToLog?: boolean }) {
  const byDate = new Map<string, ScheduleListItem[]>()
  for (const s of items) byDate.set(s.classDate, [...(byDate.get(s.classDate) ?? []), s])
  return (
    <table className="calendar" aria-label={`${month} 일정`}>
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {calendarWeeks(month).map((week) => (
          <tr key={week[0].date}>
            {week.map((day) => {
              const events = byDate.get(day.date) ?? []
              const classes = ['calendar-day', day.inMonth ? '' : 'outside', events.length ? '' : 'no-events', day.date === today ? 'today' : ''].filter(Boolean).join(' ')
              return (
                <td key={day.date} className={classes}>
                  <span className="day-number">
                    <span className="day-full">{day.date}</span>
                    <span className="day-short">{Number(day.date.slice(8))}</span>
                  </span>
                  {events.length > 0 && (
                    <ul>
                      {events.map((s) => (
                        <li key={s.scheduleId} className={s.displayStatus === 'SCHEDULED' ? 'event' : 'event muted'}>
                          {linkToLog && s.status !== 'CANCELLED' ? (
                            <Link to={`/operation-logs?course_id=${s.courseId}&schedule_id=${s.scheduleId}`}>{eventText(s)}</Link>
                          ) : (
                            eventText(s)
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
