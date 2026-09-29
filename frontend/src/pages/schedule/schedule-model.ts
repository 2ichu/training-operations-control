import type { OverlappingSchedule } from '../../api/types'
import { formatTime } from '../../format'

// S13 캘린더·기간 계산. 날짜는 모두 'YYYY-MM-DD' 문자열(교육일은 시간대 없는 날짜)이며 UTC 로 계산해 시간대 영향을 받지 않는다.

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const parseMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return { y, m }
}

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

/** 'YYYY-MM' 의 첫날·마지막 날 */
export function monthRange(month: string): { from: string; to: string } {
  const { y, m } = parseMonth(month)
  return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
}

export function shiftMonth(month: string, delta: number): string {
  const { y, m } = parseMonth(month)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

/** 일요일 시작 주 단위 달력 칸(앞뒤 달의 날짜로 주를 채운다) */
export function calendarWeeks(month: string): { date: string; inMonth: boolean }[][] {
  const { y, m } = parseMonth(month)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const start = new Date(first)
  start.setUTCDate(1 - first.getUTCDay())
  const last = new Date(Date.UTC(y, m, 0))
  const weeks: { date: string; inMonth: boolean }[][] = []
  for (const cursor = start; cursor <= last || cursor.getUTCDay() !== 0; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (cursor.getUTCDay() === 0) weeks.push([])
    weeks[weeks.length - 1].push({ date: iso(cursor), inMonth: cursor.getUTCMonth() === m - 1 })
  }
  return weeks
}

/** 저장 결과의 시간 겹침 경고 문구(S13 예외 상황: 동일 강사·동일 시간대 — 차단하지 않고 알린다) */
export function overlapMessage(overlaps: OverlappingSchedule[] | undefined): string {
  if (!overlaps || overlaps.length === 0) return ''
  const list = overlaps.map((o) => `${o.courseName} ${o.roundNo}회차(${o.classDate} ${formatTime(o.startTime)}~${formatTime(o.endTime)})`).join(', ')
  return ` 같은 강사의 시간이 겹치는 회차가 있습니다: ${list}`
}
