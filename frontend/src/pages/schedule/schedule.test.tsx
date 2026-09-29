import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { CourseDetail, InstructorListItem, ScheduleListItem } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi } from '../../test/mock-api'
import { calendarWeeks, monthRange, shiftMonth } from './schedule-model'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const page = <T,>(items: T[], total = items.length) => ({ status: 200, body: { items, page: 1, size: 100, total } })
const courses = page([{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }])

const schedule = (overrides: Partial<ScheduleListItem> = {}): ScheduleListItem => ({
  scheduleId: 11,
  courseId: 3,
  courseName: '웹개발 1기',
  roundNo: 1,
  classDate: '2026-09-01',
  startTime: '09:00:00',
  endTime: '18:00:00',
  instructorId: 2,
  instructorName: '박강사',
  content: '오리엔테이션',
  status: 'SCHEDULED',
  displayStatus: 'COMPLETED',
  ...overrides,
})

const course = (overrides: Partial<CourseDetail> = {}): CourseDetail => ({
  courseId: 3,
  courseName: '웹개발 1기',
  startDate: '2026-09-01',
  endDate: '2026-12-31',
  totalHours: 600,
  trainingSite: '본원',
  managerUserId: 7,
  managerName: '김운영',
  submissionDueDate: null,
  status: 'IN_PROGRESS',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  traineeSummary: [],
  instructorAssignments: [
    { assignmentId: 1, instructorId: 2, instructorName: '박강사', roundNo: null, status: 'ASSIGNED', assignedAt: '2026-08-03T00:00:00.000Z' },
    { assignmentId: 2, instructorId: 4, instructorName: '최강사', roundNo: 5, status: 'ASSIGNED', assignedAt: '2026-08-03T00:00:00.000Z' },
    { assignmentId: 3, instructorId: 6, instructorName: '정강사', roundNo: null, status: 'CANCELLED', assignedAt: '2026-08-03T00:00:00.000Z' },
  ],
  schedules: [
    { scheduleId: 11, roundNo: 1, classDate: '2026-09-01', startTime: '09:00:00', endTime: '18:00:00', instructorId: 2, status: 'SCHEDULED', displayStatus: 'COMPLETED' },
    { scheduleId: 12, roundNo: 4, classDate: '2026-09-04', startTime: '09:00:00', endTime: '18:00:00', instructorId: 2, status: 'SCHEDULED', displayStatus: 'SCHEDULED' },
  ],
  ...overrides,
})
const instructors = (items: Partial<InstructorListItem>[]) =>
  page(items.map((i, n) => ({ instructorId: n + 2, name: `강사${n}`, contact: null, status: 'ACTIVE', assignedCourseCount: 1, createdAt: '', updatedAt: null, ...i })))

describe('schedule-model', () => {
  it('월 범위·이동·일요일 시작 주 단위 달력', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    const weeks = calendarWeeks('2026-09') // 2026-09-01 은 화요일
    expect(weeks[0][0]).toEqual({ date: '2026-08-30', inMonth: false })
    expect(weeks[0][2]).toEqual({ date: '2026-09-01', inMonth: true })
    expect(weeks.at(-1)?.at(-1)).toEqual({ date: '2026-10-03', inMonth: false })
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })
})

describe('S13 교육일정(과정 진입)', () => {
  it('과정 지정 시 목록 우선·배정 패널, 신규 회차는 해당 회차에 유효 배정된 강사만 고르고 시간 겹침 경고를 보여준다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /instructors': instructors([{ name: '박강사' }, { name: '최강사' }]),
      'GET /courses/3': { status: 200, body: course() },
      'GET /schedules': page([schedule(), schedule({ scheduleId: 12, roundNo: 4, classDate: '2026-09-04', displayStatus: 'SCHEDULED', content: null })]),
      'POST /courses/3/schedules': {
        status: 201,
        body: { scheduleId: 13, warnings: { overlappingSchedules: [{ scheduleId: 90, courseId: 8, courseName: '데이터 2기', roundNo: 3, classDate: '2026-09-10', startTime: '13:00:00', endTime: '15:00:00' }] } },
      },
    })
    const user = userEvent.setup()
    renderAt('/schedules?course_id=3')
    expect(await screen.findByRole('heading', { name: '교육일정 — 웹개발 1기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '목록' })).toHaveAttribute('aria-pressed', 'true')
    const panel = screen.getByRole('region', { name: '강사 배정' })
    expect(within(panel).getByText('과정 전체')).toBeInTheDocument()
    expect(within(panel).queryByText('정강사')).not.toBeInTheDocument() // 취소된 배정은 기본 숨김
    await waitFor(() => expect(screen.getByRole('row', { name: /1회차.*오리엔테이션/ })).toHaveTextContent('진행완료'))
    // 회차 클릭 → 해당 회차 운영일지(S17)
    expect(screen.getByRole('link', { name: '1회차' })).toHaveAttribute('href', '/operation-logs?course_id=3&schedule_id=11')

    await user.click(screen.getByRole('button', { name: '신규 회차 추가' }))
    const dialog = screen.getByRole('dialog', { name: '회차 추가' })
    expect(within(dialog).getByLabelText('회차')).toHaveValue(5) // 마지막 회차 + 1
    // 5회차: 과정 전체(박강사) + 5회차 배정(최강사). 취소된 배정(정강사)은 제외
    expect(within(within(dialog).getByLabelText('강사')).getAllByRole('option').map((o) => o.textContent)).toEqual(['선택', '박강사', '최강사'])
    await user.clear(within(dialog).getByLabelText('회차'))
    await user.type(within(dialog).getByLabelText('회차'), '6')
    expect(within(within(dialog).getByLabelText('강사')).getAllByRole('option').map((o) => o.textContent)).toEqual(['선택', '박강사'])
    await user.type(within(dialog).getByLabelText('교육일'), '2026-09-10')
    await user.selectOptions(within(dialog).getByLabelText('강사'), '박강사')
    await user.type(within(dialog).getByLabelText('내용'), '실습')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await screen.findByText(/6회차를 추가했습니다\. 같은 강사의 시간이 겹치는 회차가 있습니다: 데이터 2기 3회차\(2026-09-10 13:00~15:00\)/)).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ round_no: 6, class_date: '2026-09-10', start_time: '09:00', end_time: '18:00', instructor_id: 2, content: '실습' })
    expect(calls.find((c) => c.path === '/schedules')?.query.get('course_id')).toBe('3')
  })

  it('휴강은 사유 필수, 강사 재배정은 현재 강사를 뺀 유효 배정 강사 중에서, 수정은 바뀐 필드만', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /instructors': instructors([]),
      'GET /courses/3': { status: 200, body: course() },
      'GET /schedules': page([schedule({ scheduleId: 15, roundNo: 5, classDate: '2026-10-01', displayStatus: 'SCHEDULED' })]),
      'POST /schedules/15/cancel-class': { status: 200, body: { scheduleId: 15, status: 'CANCELLED' } },
      'POST /schedules/15/reassign-instructor': { status: 200, body: { scheduleId: 15 } },
      'PATCH /schedules/15': { status: 200, body: { scheduleId: 15 } },
    })
    const user = userEvent.setup()
    renderAt('/schedules?course_id=3')

    await user.click(await screen.findByRole('button', { name: '웹개발 1기 5회차 휴강 처리' }))
    let dialog = screen.getByRole('dialog', { name: '휴강 처리' })
    await user.click(within(dialog).getByRole('button', { name: '휴강 처리' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('휴강 사유를 입력해 주세요.')
    await user.type(within(dialog).getByLabelText('휴강 사유(필수)'), '강사 사정')
    await user.click(within(dialog).getByRole('button', { name: '휴강 처리' }))
    expect(await screen.findByText('5회차를 휴강 처리했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/schedules/15/cancel-class')?.body).toEqual({ reason: '강사 사정' })

    await user.click(screen.getByRole('button', { name: '웹개발 1기 5회차 강사 재배정' }))
    dialog = screen.getByRole('dialog', { name: '강사 재배정' })
    await waitFor(() => expect(within(within(dialog).getByLabelText('새 강사')).getAllByRole('option').map((o) => o.textContent)).toEqual(['선택', '최강사']))
    await user.selectOptions(within(dialog).getByLabelText('새 강사'), '최강사')
    await user.type(within(dialog).getByLabelText('재배정 사유(필수)'), '대강')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('5회차 강사를 바꿨습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/schedules/15/reassign-instructor')?.body).toEqual({ instructor_id: 4, reason: '대강' })

    await user.click(screen.getByRole('button', { name: '웹개발 1기 5회차 수정' }))
    dialog = screen.getByRole('dialog', { name: '회차 수정' })
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('변경한 내용이 없습니다.')
    await user.clear(within(dialog).getByLabelText('종료'))
    await user.type(within(dialog).getByLabelText('종료'), '17:00')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('5회차를 수정했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ end_time: '17:00' })
  })

  it('배정 추가(회차 지정)·배정 취소(사유 필수, 남은 예정 회차 경고)', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /instructors': (call) => (call.query.get('status') === 'ACTIVE' ? instructors([{ name: '박강사' }, { name: '한강사', instructorId: 8 }]) : instructors([])),
      'GET /courses/3': { status: 200, body: course() },
      'GET /schedules': page([]),
      'POST /courses/3/instructor-assignments': { status: 201, body: { assignmentId: 9 } },
      'POST /instructor-assignments/1/cancel': { status: 200, body: { assignmentId: 1, warnings: { remainingScheduledCount: 3 } } },
    })
    const user = userEvent.setup()
    renderAt('/schedules?course_id=3')
    const panel = await screen.findByRole('region', { name: '강사 배정' })
    await user.click(within(panel).getByRole('button', { name: '강사 배정 추가' }))
    let dialog = screen.getByRole('dialog', { name: '강사 배정 추가' })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: '한강사' })).toBeInTheDocument())
    await user.selectOptions(within(dialog).getByLabelText('강사(활동)'), '한강사')
    await user.click(within(dialog).getByLabelText('특정 회차'))
    await user.type(within(dialog).getByLabelText('배정 회차'), '7')
    await user.click(within(dialog).getByRole('button', { name: '배정' }))
    expect(await screen.findByText('한강사을(를) 7회차에 배정했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/courses/3/instructor-assignments')?.body).toEqual({ instructor_id: 8, round_no: 7 })

    await user.click(within(screen.getByRole('row', { name: /박강사.*과정 전체/ })).getByRole('button', { name: '배정 취소' }))
    dialog = screen.getByRole('dialog', { name: '배정 취소' })
    await user.click(within(dialog).getByRole('button', { name: '배정 취소' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('취소 사유를 입력해 주세요.')
    await user.type(within(dialog).getByLabelText('취소 사유(필수)'), '계약 종료')
    await user.click(within(dialog).getByRole('button', { name: '배정 취소' }))
    expect(await screen.findByText(/예정 회차 3건이 남아 있습니다/)).toBeInTheDocument()

    await user.click(within(panel).getByLabelText('취소된 배정 포함'))
    expect(within(panel).getByText('정강사')).toBeInTheDocument()
  })

  it('종료된 과정은 추가·수정 버튼이 없다(V7)', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /instructors': instructors([]),
      'GET /courses/3': { status: 200, body: course({ status: 'CLOSED' }) },
      'GET /schedules': page([schedule()]),
    })
    renderAt('/schedules?course_id=3')
    expect(await screen.findByText('종료·중단된 과정은 일정과 배정을 변경할 수 없습니다.')).toBeInTheDocument()
    await screen.findByRole('row', { name: /오리엔테이션/ })
    expect(screen.queryByRole('button', { name: '신규 회차 추가' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /휴강 처리/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '강사 배정 추가' })).not.toBeInTheDocument()
  })
})

describe('S13 캘린더 — 한 달 전체', () => {
  it('회차가 100건을 넘어도 여러 페이지를 모아 달력에 모두 표시한다', async () => {
    const all = Array.from({ length: 130 }, (_, i) => schedule({ scheduleId: 1000 + i, roundNo: i + 1, classDate: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, displayStatus: 'SCHEDULED' }))
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /instructors': instructors([]),
      'GET /schedules': (call) => {
        const page = Number(call.query.get('page'))
        return { status: 200, body: { items: all.slice((page - 1) * 100, page * 100), page, size: 100, total: all.length } }
      },
    })
    renderAt('/schedules?month=2026-09')
    const calendar = await screen.findByRole('table', { name: '2026-09 일정' })
    await waitFor(() => expect(within(calendar).getByText(/웹개발 1기 130회차/)).toBeInTheDocument()) // 2페이지의 마지막 회차
    expect(within(calendar).getAllByRole('listitem')).toHaveLength(130)
    expect(calls.filter((c) => c.path === '/schedules').map((c) => c.query.get('page'))).toEqual(['1', '2'])
    expect(screen.queryByText(/만 표시합니다/)).not.toBeInTheDocument()
  })
})

describe('S13 강의 일정(강사 진입)', () => {
  it('강사 계정: 캘린더 우선, 달 단위로 조회, 변경 버튼 없음', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me({ userId: 9, roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) },
      'GET /courses': courses,
      'GET /instructors': instructors([{ name: '박강사' }]),
      'GET /schedules': page([schedule(), schedule({ scheduleId: 12, roundNo: 2, classDate: '2026-09-02', status: 'CANCELLED', displayStatus: 'CANCELLED' })]),
    })
    const user = userEvent.setup()
    renderAt('/schedules?month=2026-09')
    const calendar = await screen.findByRole('table', { name: '2026-09 일정' })
    await waitFor(() => expect(within(calendar).getByText('09:00 웹개발 1기 1회차 · 박강사 (진행완료)')).toBeInTheDocument())
    expect(within(calendar).getByText('09:00 웹개발 1기 2회차 · 박강사 (휴강)')).toHaveClass('muted')
    const first = calls.find((c) => c.path === '/schedules')!
    expect([first.query.get('from'), first.query.get('to')]).toEqual(['2026-09-01', '2026-09-30'])
    expect(screen.queryByLabelText('강사')).not.toBeInTheDocument() // 본인뿐이라 강사 필터 없음

    await user.click(screen.getByRole('button', { name: '다음 달' }))
    await waitFor(() => expect(calls.at(-1)?.query.get('from')).toBe('2026-10-01'))
    await user.click(screen.getByRole('button', { name: '목록' }))
    await screen.findByRole('columnheader', { name: '과정' })
    expect(screen.queryByRole('button', { name: /수정/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '신규 회차 추가' })).not.toBeInTheDocument()
  })
})
