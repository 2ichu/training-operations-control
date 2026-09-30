import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { ClosureItem, CourseDetail, CourseListItem } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

const managers = { status: 200, body: { items: [{ userId: 7, name: '김운영' }, { userId: 8, name: '이담당' }] } }

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
  status: 'PREPARING',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  traineeSummary: [
    { status: 'CONFIRMED', count: 12 },
    { status: 'APPLIED', count: 3 },
  ],
  instructorAssignments: [{ assignmentId: 1, instructorId: 2, instructorName: '박강사', roundNo: null, status: 'ASSIGNED', assignedAt: '2026-08-03T00:00:00.000Z' }],
  schedules: [{ scheduleId: 11, roundNo: 1, classDate: '2026-09-01', startTime: '09:00:00', endTime: '18:00:00', instructorId: 2, status: 'SCHEDULED', displayStatus: 'COMPLETED' }],
  ...overrides,
})

const listItem = (overrides: Partial<CourseListItem> = {}): CourseListItem => {
  const { traineeSummary: _t, instructorAssignments: _a, schedules: _s, ...base } = course()
  return { ...base, confirmedTraineeCount: 12, ...overrides }
}

const checklist = (overrides: Partial<Record<number, number>> = {}): { items: ClosureItem[] } => ({
  items: [
    { item: 1, label: '미출결 대상자', classification: 'BLOCKING', count: overrides[1] ?? 0 },
    { item: 2, label: '퇴실 미확인 출결', classification: 'WARNING', count: overrides[2] ?? 0 },
    { item: 3, label: '미종결 확인 필요 건', classification: 'BLOCKING', count: overrides[3] ?? 0 },
    { item: 4, label: '운영일지 누락', classification: 'WARNING', count: overrides[4] ?? 0 },
    { item: 9, label: '변경이력 존재 여부', classification: 'NOT_NEEDED', count: 0 },
  ],
})

describe('S15 과정 목록', () => {
  it('목록·필터를 보여주고, 운영담당자에게는 등록 버튼과 담당자 필터가 있다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': { status: 200, body: { items: [listItem()], page: 1, size: 20, total: 1 } },
      'GET /courses/manager-candidates': managers,
    })
    const user = userEvent.setup()
    renderAt('/courses')
    const row = await screen.findByRole('row', { name: /웹개발 1기/ })
    expect(within(row).getByRole('link', { name: '웹개발 1기' })).toHaveAttribute('href', '/courses/3')
    expect(within(row).getByText('2026-09-01 ~ 2026-12-31')).toBeInTheDocument()
    expect(within(row).getByText('김운영')).toBeInTheDocument()
    expect(within(row).getByText('12명')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '신규 과정 등록' })).toHaveAttribute('href', '/courses/new')

    const last = () => calls.filter((c) => c.path === '/courses').at(-1)!.query
    await user.selectOptions(screen.getByLabelText('상태'), 'IN_PROGRESS')
    await screen.findByRole('option', { name: '이담당' }) // 담당자 후보가 온 뒤에 고른다
    await user.selectOptions(screen.getByLabelText('담당자'), '8')
    await user.type(screen.getByLabelText('과정명'), '웹')
    await user.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => {
      expect(last().get('status')).toBe('IN_PROGRESS')
      expect(last().get('manager_user_id')).toBe('8')
      expect(last().get('name')).toBe('웹')
    })
  })

  it('강사에게는 등록 버튼·담당자 필터가 없고 담당자 후보도 요청하지 않는다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) },
      'GET /courses': { status: 200, body: { items: [listItem()], page: 1, size: 20, total: 1 } },
    })
    renderAt('/courses')
    await screen.findByRole('row', { name: /웹개발 1기/ })
    expect(screen.queryByRole('link', { name: '신규 과정 등록' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('담당자')).not.toBeInTheDocument()
    expect(calls.some((c) => c.path === '/courses/manager-candidates')).toBe(false)
  })
})

describe('S16 과정 등록', () => {
  it('필수값·기간을 검사하고, 등록하면 상세로 이동한다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses/manager-candidates': managers,
      'POST /courses': { status: 201, body: { courseId: 42 } },
      'GET /courses/42': { status: 200, body: course({ courseId: 42, courseName: '신규 과정', traineeSummary: [], instructorAssignments: [], schedules: [] }) },
    })
    const user = userEvent.setup()
    renderAt('/courses/new')
    await screen.findByRole('option', { name: '김운영' })

    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(screen.getByText('과정명을 입력해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('담당자를 선택해 주세요.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    await user.type(screen.getByLabelText('과정명'), '신규 과정')
    await user.type(screen.getByLabelText('시작일'), '2027-03-01')
    await user.type(screen.getByLabelText('종료일'), '2027-02-01')
    await user.type(screen.getByLabelText('총교육시간'), '120')
    await user.type(screen.getByLabelText('훈련장소'), '별관')
    await user.selectOptions(screen.getByLabelText('담당자'), '7')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(screen.getByText('종료일은 시작일보다 빠를 수 없습니다.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('종료일'))
    await user.type(screen.getByLabelText('종료일'), '2027-05-31')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByRole('heading', { name: '신규 과정' })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      course_name: '신규 과정',
      start_date: '2027-03-01',
      end_date: '2027-05-31',
      total_hours: 120,
      training_site: '별관',
      manager_user_id: 7,
    })
  })
})

describe('S16 과정 상세', () => {
  it('탭으로 훈련생·강사배정·훈련일정을 보여주고, 수정은 바뀐 필드와 사유만 보낸다', async () => {
    let current = course()
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses/3': () => ({ status: 200, body: current }),
      'GET /courses/manager-candidates': managers,
      'PATCH /courses/3': ({ body }) => {
        current = course({ trainingSite: (body as { training_site: string }).training_site })
        return { status: 200, body: {} }
      },
    })
    const user = userEvent.setup()
    renderAt('/courses/3')
    const tabpanel = await screen.findByRole('tabpanel')
    expect(within(tabpanel).getByRole('row', { name: '확정 12명' })).toBeInTheDocument()
    expect(within(tabpanel).getByRole('row', { name: '신청 3명' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '강사배정' }))
    expect(within(screen.getByRole('tabpanel')).getByRole('row', { name: /박강사 과정 전체 배정/ })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '훈련일정' }))
    expect(within(screen.getByRole('tabpanel')).getByRole('row', { name: /1회차 2026-09-01 09:00~18:00 박강사 진행완료/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '수정' }))
    await screen.findByRole('option', { name: '이담당' })
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByText('변경한 내용이 없습니다.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('훈련장소'))
    await user.type(screen.getByLabelText('훈련장소'), '별관 3층')
    await user.type(screen.getByLabelText('수정 사유(선택)'), '훈련장 변경')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('저장했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ training_site: '별관 3층', reason: '훈련장 변경' })
    expect(screen.getByText('별관 3층')).toBeInTheDocument()
  })

  it('결과물 제출기한(D-04): 상세에 표시, 바꾸면 바뀐 기한만 보내고 재판정 건수를 안내, 비우면 null(기한 없음)', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses/3': { status: 200, body: course({ submissionDueDate: '2026-10-15' }) },
      'GET /courses/manager-candidates': managers,
      'PATCH /courses/3': ({ body }) => ({ status: 200, body: (body as { submission_due_date: string | null }).submission_due_date ? { rejudgedSubmissionCount: 4 } : {} }),
    })
    const user = userEvent.setup()
    renderAt('/courses/3')
    expect(await screen.findByText('2026-10-15')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '수정' }))
    const due = screen.getByLabelText('결과물 제출기한(선택)')
    expect(due).toHaveValue('2026-10-15')
    await user.clear(due)
    await user.type(due, '2026-10-01')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('저장했습니다. 새 제출기한으로 결과물 4건의 제출상태를 다시 판정했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ submission_due_date: '2026-10-01' })

    await user.click(screen.getByRole('button', { name: '수정' }))
    await user.clear(screen.getByLabelText('결과물 제출기한(선택)'))
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ submission_due_date: null }))
  })

  it('운영중 전환: 확정 훈련생이 없으면(409) 경고 후 확인하면 acknowledge 로 다시 보낸다', async () => {
    let current = course({ status: 'RECRUITING', traineeSummary: [] })
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses/3': () => ({ status: 200, body: current }),
      'POST /courses/3/start': ({ body }) => {
        if (!(body as { acknowledge_no_confirmed_trainees?: boolean }).acknowledge_no_confirmed_trainees) {
          return { status: 409, body: { statusCode: 409, code: 'NO_CONFIRMED_TRAINEES', message: '확정 훈련생이 없습니다.' } }
        }
        current = course({ status: 'IN_PROGRESS', traineeSummary: [] })
        return { status: 200, body: {} }
      },
    })
    const user = userEvent.setup()
    renderAt('/courses/3')
    expect(screen.queryByRole('button', { name: '모집 시작' })).not.toBeInTheDocument() // 모집중에서는 모집 시작 없음
    await user.click(await screen.findByRole('button', { name: '운영중 전환' }))
    const dialog = screen.getByRole('dialog', { name: '운영중 전환' })
    await user.click(within(dialog).getByRole('button', { name: '운영중 전환' }))
    expect(await within(dialog).findByText(/확정 훈련생이 없습니다/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '확정 훈련생 없이 전환' }))
    expect(await screen.findByText('상태를 변경했습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/courses/3/start').map((c) => c.body)).toEqual([{}, { acknowledge_no_confirmed_trainees: true }])
    expect(screen.getByRole('button', { name: '종료 처리' })).toBeInTheDocument()
  })

  it('중단 처리는 사유가 필수다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses/3': { status: 200, body: course() },
      'POST /courses/3/suspend': { status: 200, body: {} },
    })
    const user = userEvent.setup()
    renderAt('/courses/3')
    await user.click(await screen.findByRole('button', { name: '중단 처리' }))
    const dialog = screen.getByRole('dialog', { name: '중단 처리' })
    await user.click(within(dialog).getByRole('button', { name: '중단 처리' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('중단 사유를 입력해 주세요.')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    await user.type(within(dialog).getByLabelText('중단 사유(필수)'), '수강 인원 미달')
    await user.click(within(dialog).getByRole('button', { name: '중단 처리' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ reason: '수강 인원 미달' }))
  })

  it('종료 처리: 필수 차단 항목이 있으면 종료할 수 없다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses/3': { status: 200, body: course({ status: 'IN_PROGRESS' }) },
      'GET /courses/3/closure-checklist': { status: 200, body: checklist({ 1: 2, 4: 1 }) },
    })
    const user = userEvent.setup()
    renderAt('/courses/3')
    await user.click(await screen.findByRole('button', { name: '종료 처리' }))
    const dialog = screen.getByRole('dialog', { name: '종료 처리' })
    expect(await within(dialog).findByText(/필수 차단 항목\(미출결 대상자\)이 남아 있어/)).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: '미출결 대상자' })).toHaveAttribute('href', '/attendance/course?course_id=3')
    expect(within(dialog).getByRole('button', { name: '종료' })).toBeDisabled()
  })

  it('종료 처리: 경고 항목만 있으면 사유를 받아 종료한다', async () => {
    let current = course({ status: 'IN_PROGRESS' })
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses/3': () => ({ status: 200, body: current }),
      'GET /courses/3/closure-checklist': { status: 200, body: checklist({ 4: 2 }) },
      'POST /courses/3/close': () => {
        current = course({ status: 'CLOSED' })
        return { status: 200, body: {} }
      },
    })
    const user = userEvent.setup()
    renderAt('/courses/3')
    await user.click(await screen.findByRole('button', { name: '종료 처리' }))
    const dialog = screen.getByRole('dialog', { name: '종료 처리' })
    const submit = await within(dialog).findByRole('button', { name: '사유를 남기고 종료' })
    await user.click(submit)
    expect(within(dialog).getByRole('alert')).toHaveTextContent('종료 사유를 입력해 주세요.')
    await user.type(within(dialog).getByRole('textbox'), '운영일지는 종이 대장으로 보관')
    await user.click(submit)
    expect(await screen.findByText('종료·중단된 과정은 정보와 하위 데이터를 변경할 수 없습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/courses/3/close')?.body).toEqual({ override_reason: '운영일지는 종이 대장으로 보관' })
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '중단 처리' })).not.toBeInTheDocument()
  })

  it('강사: 수정·상태 전환·종료 체크리스트 탭이 없다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) },
      'GET /courses/3': { status: 200, body: course({ status: 'IN_PROGRESS' }) },
    })
    renderAt('/courses/3')
    await screen.findByRole('tabpanel')
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '종료 처리' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '종료 체크리스트' })).not.toBeInTheDocument()
  })
})
