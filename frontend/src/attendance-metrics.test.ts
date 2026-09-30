import { describe, expect, it } from 'vitest'
import { attendedDays, completionRisk, monthsOf, monthTally, rateOf, tally } from './attendance-metrics'

const cells = (statuses: (string | null)[]) => statuses.map((displayStatus, i) => ({ scheduleId: i + 1, displayStatus }))
const sessions = (dates: string[]) => dates.map((classDate, i) => ({ scheduleId: i + 1, classDate }))

describe('출석률 산식(백엔드와 동일)', () => {
  it('지각·조퇴 3회를 결석 1일로 환산하고 휴강은 제외한다', () => {
    const t = tally(cells(['PRESENT', 'LATE', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED', null, 'NOT_CHECKED']))
    expect(t).toMatchObject({ applicable: 7, present: 1, late: 2, earlyLeave: 1, excused: 1, absent: 1, notChecked: 1 })
    expect(attendedDays(t)).toBe(1 + 2 + 1 + 1 - 1) // 지각·조퇴 3회 → -1
    expect(rateOf(t)).toBeCloseTo(4 / 7)
    expect(rateOf(tally(cells([null])))).toBeNull()
  })
})

describe('이수 위험 판정(80%)', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']
  it('진행된 회차 기준 80% 미만이면 위험, 남은 회차를 모두 채워도 못 미치면 이수 곤란, 이상 없으면 null', () => {
    const today = '2026-09-05'
    expect(completionRisk(cells(['PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'PRESENT', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED']), sessions(dates), today)).toBeNull()
    const risk = completionRisk(cells(['PRESENT', 'PRESENT', 'PRESENT', 'ABSENT', 'ABSENT', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED']), sessions(dates), today)
    expect(risk).toMatchObject({ level: 'RISK', heldCount: 5, remainingCount: 5 })
    expect(risk?.currentRate).toBeCloseTo(0.6)
    const bad = completionRisk(cells(['ABSENT', 'ABSENT', 'ABSENT', 'ABSENT', 'PRESENT', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED', 'NOT_CHECKED']), sessions(dates), today)
    expect(bad?.level).toBe('IMPOSSIBLE')
    expect(completionRisk(cells(Array(10).fill('NOT_CHECKED')), sessions(dates), '2026-08-31')).toBeNull()
  })

  it('월별 출석률은 그 달 회차만으로 계산한다', () => {
    const ss = sessions(['2026-09-01', '2026-09-02', '2026-10-01'])
    expect(monthsOf(ss)).toEqual(['2026-09', '2026-10'])
    const c = cells(['PRESENT', 'ABSENT', 'PRESENT'])
    expect(rateOf(monthTally(c, ss, '2026-09'))).toBeCloseTo(0.5)
    expect(rateOf(monthTally(c, ss, '2026-10'))).toBe(1)
  })
})
