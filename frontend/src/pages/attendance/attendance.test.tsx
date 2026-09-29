import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { AttendanceChangeLog, AttendanceMatrix, AttendanceRecord, RosterItem, ScheduleListItem } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const courses = { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }], page: 1, size: 100, total: 1 } }
const page = <T,>(items: T[]) => ({ status: 200, body: { items, page: 1, size: 100, total: items.length } })

const schedule = (overrides: Partial<ScheduleListItem> = {}): ScheduleListItem => ({
  scheduleId: 11,
  courseId: 3,
  courseName: '웹개발 1기',
  roundNo: 2,
  classDate: '2026-09-28',
  startTime: '09:00:00',
  endTime: '18:00:00',
  instructorId: 2,
  instructorName: '박강사',
  content: null,
  status: 'SCHEDULED',
  displayStatus: 'SCHEDULED',
  ...overrides,
})

const roster: RosterItem[] = [
  { traineeId: 1, name: '가', attendanceId: null, checkInTime: null, checkOutTime: null, attendanceStatus: null, sourceType: null, displayStatus: 'NOT_CHECKED' },
  { traineeId: 2, name: '나', attendanceId: null, checkInTime: null, checkOutTime: null, attendanceStatus: null, sourceType: null, displayStatus: 'NOT_CHECKED' },
  { traineeId: 3, name: '다', attendanceId: 501, checkInTime: '2026-09-28T00:05:00.000Z', checkOutTime: null, attendanceStatus: 'PRESENT', sourceType: 'MANUAL', displayStatus: 'PRESENT' },
  { traineeId: 4, name: '라', attendanceId: 502, checkInTime: '2026-09-28T00:00:00.000Z', checkOutTime: null, attendanceStatus: 'PRESENT', sourceType: 'OFFICIAL', displayStatus: 'PRESENT' },
]

const record = (overrides: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  attendanceId: 501,
  traineeId: 3,
  scheduleId: 11,
  checkInTime: '2026-09-28T00:05:00.000Z',
  checkOutTime: null,
  attendanceStatus: 'PRESENT',
  sourceType: 'MANUAL',
  lastModifiedAt: null,
  ...overrides,
})

describe('S07 일일 출결', () => {
  it('미출결은 계산 badge 로 보이고, 선택한 미출결만 입실 확인(처리 시각 지정) — 이미 처리된 건은 건너뛰었다고 안내', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /schedules': page([schedule()]),
      'GET /schedules/11/attendance-roster': { status: 200, body: { items: roster } },
      'POST /schedules/11/attendance/check-in': { status: 201, body: { created: [{ attendanceId: 600 }], alreadyExists: [{ traineeId: 2, attendanceId: 601 }], notEligible: [] } },
    })
    const user = userEvent.setup()
    renderAt('/attendance/daily?date=2026-09-28')
    const row = await screen.findByRole('row', { name: /^가 선택/ })
    expect(within(row).getByText('미출결')).toHaveClass('badge-computed')
    expect(calls.find((c) => c.path === '/schedules')?.query.get('from')).toBe('2026-09-28')
    expect(screen.getByLabelText('회차')).toHaveDisplayValue('웹개발 1기 2회차 09:00~18:00')

    expect(screen.getByRole('button', { name: '입실 확인 (0)' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '가 선택' }))
    await user.click(screen.getByRole('checkbox', { name: '나 선택' }))
    await user.click(screen.getByRole('checkbox', { name: '다 선택' })) // 이미 기록 있음 → 입실 대상 아님
    expect(screen.getByRole('button', { name: '결석 확정 (2)' })).toBeEnabled()
    await user.type(screen.getByLabelText('처리 시각(비우면 현재)'), '09:10')
    await user.click(screen.getByRole('button', { name: '입실 확인 (2)' }))
    expect(await screen.findByText('입실 확인 1건 처리했습니다. 이미 처리됐거나 대상이 아닌 1건은 건너뛰었습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ trainee_ids: [1, 2], check_in_time: '2026-09-28T09:10:00+09:00' })
  })

  it('퇴실 확인은 기록이 있고 퇴실이 비었으며 공식 출결이 아닌 행만 대상', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /schedules': page([schedule()]),
      'GET /schedules/11/attendance-roster': { status: 200, body: { items: roster } },
      'POST /attendance/check-out': { status: 200, body: { updated: [{ attendanceId: 501 }], alreadyExists: [], notFound: [] } },
    })
    const user = userEvent.setup()
    renderAt('/attendance/daily?date=2026-09-28')
    await user.click(await screen.findByRole('checkbox', { name: '전체 선택' }))
    expect(screen.getByRole('button', { name: '퇴실 확인 (1)' })).toBeEnabled() // 다(내부수기)만, 라(공식)는 제외
    await user.click(screen.getByRole('button', { name: '퇴실 확인 (1)' }))
    await waitFor(() => expect(calls.find((c) => c.path === '/attendance/check-out')?.body).toEqual({ attendance_ids: [501] }))
  })

  it('강사: 결석 확정은 본인 회차에서 가능(D-07), 수정 버튼은 없고(상세만), 휴강 회차는 명단을 부르지 않는다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) },
      'GET /courses': courses,
      'GET /schedules': page([schedule(), schedule({ scheduleId: 12, roundNo: 3, status: 'CANCELLED', displayStatus: 'CANCELLED' })]),
      'GET /schedules/11/attendance-roster': { status: 200, body: { items: roster } },
    })
    const user = userEvent.setup()
    renderAt('/attendance/daily?date=2026-09-28')
    const row = await screen.findByRole('row', { name: /^다 선택/ })
    expect(screen.getByRole('button', { name: /결석 확정/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /입실 확인/ })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '상세' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('회차'), '12')
    expect(await screen.findByText('휴강 처리된 회차입니다. 출결을 기록하지 않습니다.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/schedules/12/attendance-roster')).toBe(false)
  })
})

describe('S09 출결 수정', () => {
  it('바뀐 필드·사유·기대 수정시각만 보내고, 충돌(STALE)이면 최신 값을 다시 불러온다', async () => {
    let current = record()
    let stale = true
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /schedules': page([schedule()]),
      'GET /schedules/11/attendance-roster': { status: 200, body: { items: roster } },
      'GET /attendance/501': () => ({ status: 200, body: current }),
      'POST /attendance/501/correct': () => {
        if (stale) {
          stale = false
          current = record({ lastModifiedAt: '2026-09-28T01:00:00.000Z' })
          return { status: 409, body: { statusCode: 409, code: 'STALE_ATTENDANCE', message: '다른 곳에서 이미 수정되었습니다.' } }
        }
        return { status: 200, body: {} }
      },
    })
    const user = userEvent.setup()
    renderAt('/attendance/daily?date=2026-09-28')
    await user.click(within(await screen.findByRole('row', { name: /^다 선택/ })).getByRole('button', { name: '수정' }))
    const dialog = screen.getByRole('dialog', { name: '출결 수정' })
    expect(await within(dialog).findByLabelText('입실')).toHaveValue('2026-09-28T09:05')

    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('변경한 내용이 없습니다.')
    await user.selectOptions(within(dialog).getByLabelText('출결상태'), 'LATE')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('수정 사유를 입력해 주세요.')
    await user.type(within(dialog).getByLabelText('수정 사유(필수)'), '지각 정정')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(calls.filter((c) => c.method === 'POST')[0].body).toEqual({ attendance_status: 'LATE', reason: '지각 정정', expected_last_modified_at: null })
    // 409 후 최신 값(lastModifiedAt)으로 폼이 초기화된다 — 다시 입력해 저장
    await waitFor(() => expect(calls.filter((c) => c.path === '/attendance/501').length).toBe(2))
    await user.selectOptions(within(dialog).getByLabelText('출결상태'), 'LATE')
    await user.type(within(dialog).getByLabelText('수정 사유(필수)'), '지각 정정')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('다의 출결을 수정했습니다.')).toBeInTheDocument()
    expect(calls.filter((c) => c.method === 'POST')[1].body).toMatchObject({ expected_last_modified_at: '2026-09-28T01:00:00.000Z' })
  })
})

describe('S08 과정별 출결', () => {
  it('매트릭스: 기록 셀은 수정 모달, 미출결 셀은 그 회차의 일일 출결로 연결, 출석률 표시', async () => {
    const matrix: AttendanceMatrix = {
      schedules: [
        { scheduleId: 11, roundNo: 1, classDate: '2026-09-21', status: 'SCHEDULED' },
        { scheduleId: 12, roundNo: 2, classDate: '2026-09-22', status: 'CANCELLED' },
        { scheduleId: 13, roundNo: 3, classDate: '2026-09-23', status: 'SCHEDULED' },
      ],
      items: [
        {
          traineeId: 3,
          name: '다',
          attendanceRate: 0.5,
          cells: [
            { scheduleId: 11, attendanceId: 501, displayStatus: 'PRESENT' },
            { scheduleId: 12, attendanceId: null, displayStatus: null },
            { scheduleId: 13, attendanceId: null, displayStatus: 'NOT_CHECKED' },
          ],
        },
      ],
    }
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /courses/3/attendance-matrix': { status: 200, body: matrix },
      'GET /attendance/501': { status: 200, body: record() },
    })
    const user = userEvent.setup()
    renderAt('/attendance/course')
    expect(await screen.findByText('과정을 선택해 주세요.')).toBeInTheDocument()
    await screen.findByRole('option', { name: '웹개발 1기' }) // 과정 목록이 온 뒤에 고른다(먼저 고르면 옵션이 없어 실패)
    await user.selectOptions(screen.getByLabelText('과정(필수)'), '3')
    const row = await screen.findByRole('row', { name: /다/ })
    expect(within(row).getByText('50.0%')).toBeInTheDocument()
    expect(within(row).getByText('휴')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '다 3회차 미출결 — 일일 출결에서 처리' })).toHaveAttribute('href', '/attendance/daily?date=2026-09-23&course_id=3&schedule_id=13')
    await user.click(within(row).getByRole('button', { name: '다 1회차 출석' }))
    expect(await screen.findByRole('dialog', { name: '출결 수정' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('훈련생명'), '다')
    await user.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/courses/3/attendance-matrix').at(-1)!.query.get('trainee_name')).toBe('다'))
  })
})

describe('S10 출결 수정이력', () => {
  it('회차와 바뀐 필드(전 → 후)를 보여주고, 시스템 수정은 시스템으로 표시', async () => {
    const log = (overrides: Partial<AttendanceChangeLog>): AttendanceChangeLog => ({
      logId: 1,
      attendanceId: 501,
      traineeId: 3,
      traineeName: '다',
      actorType: 'USER',
      changedBy: 7,
      changedByName: '김운영',
      changedAt: '2026-09-28T01:00:00.000Z',
      beforeValue: { attendance_status: 'PRESENT', last_modified_at: null },
      afterValue: { attendance_status: 'LATE', last_modified_at: '2026-09-28T01:00:00.000Z' },
      reason: '지각 정정',
      scheduleId: 11,
      roundNo: 1,
      classDate: '2026-09-21',
      courseId: 3,
      courseName: '웹개발 1기',
      ...overrides,
    })
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /attendance-change-logs': page([log({}), log({ logId: 2, actorType: 'SYSTEM_BATCH', changedBy: null, changedByName: null, reason: '공식 출결 대사 반영' })]),
    })
    const user = userEvent.setup()
    renderAt('/attendance-change-logs')
    const row = await screen.findByRole('row', { name: /지각 정정/ })
    expect(within(row).getByText('웹개발 1기 · 1회차', { exact: false })).toBeInTheDocument()
    expect(within(row).getByText('출석')).toBeInTheDocument()
    expect(within(row).getByText('지각')).toBeInTheDocument()
    expect(within(row).queryByText(/last_modified_at/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /공식 출결 대사 반영/ })).getByText('시스템(배치)')).toBeInTheDocument()
    await user.type(screen.getByLabelText('훈련생명'), '다')
    await user.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/attendance-change-logs').at(-1)!.query.get('trainee_name')).toBe('다'))
  })
})
