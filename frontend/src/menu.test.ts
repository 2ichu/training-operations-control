import { describe, expect, it } from 'vitest'
import { formatDateTime, formatTime, formatTimeOn, formatTrainees } from './format'
import { visibleMenu } from './menu'
import { INSTRUCTOR_PERMISSIONS, OPS_PERMISSIONS, SYS_PERMISSIONS, grants } from './test/mock-api'

const screens = (permissions: Parameters<typeof visibleMenu>[0]) => visibleMenu(permissions).flatMap((g) => g.items.map((i) => i.screenId))

describe('visibleMenu (역할별 메뉴 — 조회 권한 기준)', () => {
  it('강사에게는 확인/조치·시스템 관리 메뉴가 없다(baseline 4-2: S22~S24 메뉴 미노출)', () => {
    const s = screens(INSTRUCTOR_PERMISSIONS)
    expect(s).toContain('S01')
    expect(s).toContain('S17')
    expect(s).not.toContain('S22')
    expect(s).not.toContain('S25')
    expect(visibleMenu(INSTRUCTOR_PERMISSIONS).map((g) => g.label)).not.toContain('시스템 관리')
  })

  it('S20(미제출)은 S19 조회 권한으로 판정한다', () => {
    expect(screens(OPS_PERMISSIONS)).toEqual(expect.arrayContaining(['S19', 'S20']))
    expect(screens(grants({ S01: 'R' }))).not.toContain('S20')
  })

  it('조회(R) 없이 다른 권한만 있으면 메뉴에 보이지 않는다', () => {
    expect(screens(grants({ S01: 'R', S05: 'A' }))).toEqual(['S01'])
  })

  it('시스템 관리자는 S25~S28 을 본다', () => {
    expect(screens(SYS_PERMISSIONS)).toEqual(expect.arrayContaining(['S25', 'S26', 'S27', 'S28']))
  })
})

describe('format', () => {
  it('관련 훈련생: 0명 -, 2명까지 나열, 초과 시 "외 N명"', () => {
    expect(formatTrainees([])).toBe('-')
    expect(formatTrainees(['가', '나'])).toBe('가, 나')
    expect(formatTrainees(['가', '나', '다'])).toBe('가 외 2명')
  })

  it('기준 날짜와 같은 날이면 시각만, 다른 날이면 날짜까지(KST)', () => {
    expect(formatTimeOn('2026-09-21T00:05:00.000Z', '2026-09-21')).toBe('09:05')
    expect(formatTimeOn('2026-09-21T15:30:00.000Z', '2026-09-21')).toBe('2026-09-22 00:30') // KST 로 다음 날
    expect(formatTimeOn(null, '2026-09-21')).toBe('-')
  })

  it('시각은 KST 로 표시한다', () => {
    expect(formatDateTime('2026-09-27T16:30:00.000Z')).toBe('2026-09-28 01:30')
    expect(formatDateTime(null)).toBe('-')
    expect(formatTime('09:05:00')).toBe('09:05')
  })
})
