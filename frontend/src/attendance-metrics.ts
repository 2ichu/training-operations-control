// 출석률·이수 위험 계산(화면 표시용). 산식은 백엔드 common/attendance-rate.ts 와 같다:
//   출석일수 = 출석 + 지각 + 조퇴 + 인정결석 − ⌊(지각 + 조퇴) ÷ 3⌋   (지각·조퇴 3회 = 결석 1일)
//   출석률   = 출석일수 ÷ 적용 회차(휴강 제외, 미출결·결석 포함)
// 이수 기준 80% 는 백엔드 수료 후보(S02, trainee.service ATTENDANCE_THRESHOLD)와 같은 값이다.
export const LATE_TO_ABSENCE = 3
export const COMPLETION_THRESHOLD = 0.8

export interface MatrixCell {
  scheduleId: number
  /** 휴강 회차는 null */
  displayStatus: string | null
}

export interface Tally {
  applicable: number
  present: number
  late: number
  earlyLeave: number
  excused: number
  absent: number
  notChecked: number
}

export function tally(cells: MatrixCell[]): Tally {
  const t: Tally = { applicable: 0, present: 0, late: 0, earlyLeave: 0, excused: 0, absent: 0, notChecked: 0 }
  for (const c of cells) {
    if (c.displayStatus === null) continue
    t.applicable += 1
    if (c.displayStatus === 'PRESENT') t.present += 1
    else if (c.displayStatus === 'LATE') t.late += 1
    else if (c.displayStatus === 'EARLY_LEAVE') t.earlyLeave += 1
    else if (c.displayStatus === 'EXCUSED') t.excused += 1
    else if (c.displayStatus === 'ABSENT') t.absent += 1
    else t.notChecked += 1
  }
  return t
}

export function attendedDays(t: Tally): number {
  return t.present + t.late + t.earlyLeave + t.excused - Math.floor((t.late + t.earlyLeave) / LATE_TO_ABSENCE)
}

export function rateOf(t: Tally): number | null {
  return t.applicable > 0 ? attendedDays(t) / t.applicable : null
}

export interface Session {
  scheduleId: number
  classDate: string
}

export interface CompletionRisk {
  /** 진행된 회차(오늘까지) 기준 현재 출석률 */
  currentRate: number
  heldCount: number
  remainingCount: number
  /** 남은 회차를 모두 출석해도 도달 가능한 최대 출석률 */
  maxRate: number
  level: 'IMPOSSIBLE' | 'RISK'
}

/** 이수 위험: 진행된 회차 기준 현재 출석률이 80% 미만이면 위험, 남은 회차를 모두 채워도 80% 에 못 미치면 이수 곤란. 진행된 회차가 없으면 판정하지 않는다. */
export function completionRisk(cells: MatrixCell[], sessions: Session[], today: string): CompletionRisk | null {
  const date = new Map(sessions.map((s) => [s.scheduleId, s.classDate]))
  const held = tally(cells.filter((c) => (date.get(c.scheduleId) ?? '9999') <= today))
  const future = tally(cells.filter((c) => (date.get(c.scheduleId) ?? '9999') > today))
  if (held.applicable === 0) return null
  const currentRate = attendedDays(held) / held.applicable
  const total = held.applicable + future.applicable
  const maxRate = Math.min(1, (attendedDays(held) + future.applicable) / total)
  const level = maxRate < COMPLETION_THRESHOLD ? 'IMPOSSIBLE' : currentRate < COMPLETION_THRESHOLD ? 'RISK' : null
  return level ? { currentRate, heldCount: held.applicable, remainingCount: future.applicable, maxRate, level } : null
}

/** 단위 기간(월) 목록: 'YYYY-MM' 오름차순 */
export function monthsOf(sessions: Session[]): string[] {
  return [...new Set(sessions.map((s) => s.classDate.slice(0, 7)))].sort()
}

/** 한 달 안의 회차만으로 낸 출석률(단위기간 출석률) */
export function monthTally(cells: MatrixCell[], sessions: Session[], month: string): Tally {
  const inMonth = new Set(sessions.filter((s) => s.classDate.startsWith(month)).map((s) => s.scheduleId))
  return tally(cells.filter((c) => inMonth.has(c.scheduleId)))
}
