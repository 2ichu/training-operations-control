import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { EnrollmentListItem, TraineeChangeLog, TraineeDetail } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi, SYS_PERMISSIONS } from '../../test/mock-api'
import { diffFields } from '../../diff'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const courses = { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }, { courseId: 4, courseName: '데이터 2기', status: 'RECRUITING' }], page: 1, size: 100, total: 2 } }
const page = <T,>(items: T[]) => ({ status: 200, body: { items, page: 1, size: 20, total: items.length } })

const enrollment = (overrides: Partial<EnrollmentListItem> = {}): EnrollmentListItem => ({
  enrollmentId: 50,
  traineeId: 1,
  name: '김하나',
  birthDate: '1990-**-**',
  courseId: 3,
  courseName: '웹개발 1기',
  status: 'APPLIED',
  appliedAt: '2026-09-01T00:00:00.000Z',
  confirmedAt: null,
  cancelReason: null,
  ...overrides,
})

const traineeDetail = (overrides: Partial<TraineeDetail> = {}): TraineeDetail => ({
  traineeId: 1,
  name: '김하나',
  birthDate: '1990-**-**',
  contact: '***-****-5678',
  registeredAt: '2026-08-20T00:00:00.000Z',
  enrollments: [
    { enrollmentId: 50, courseId: 3, courseName: '웹개발 1기', status: 'CONFIRMED', appliedAt: '2026-09-01T00:00:00.000Z', confirmedAt: '2026-09-02T00:00:00.000Z', cancelReason: null },
    { enrollmentId: 51, courseId: 4, courseName: '데이터 2기', status: 'APPLIED', appliedAt: '2026-09-20T00:00:00.000Z', confirmedAt: null, cancelReason: null },
  ],
  ...overrides,
})

describe('S02 대상자 확인', () => {
  it('기본 탭은 신청·서류확인중, 상태별 처리 버튼과 반려 사유 필수', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /enrollments': page([enrollment(), enrollment({ enrollmentId: 52, name: '이두리', status: 'REVIEWING' })]),
      'POST /enrollments/50/reject': { status: 200, body: {} },
    })
    const user = userEvent.setup()
    renderAt('/enrollments')
    const applied = await screen.findByRole('row', { name: /김하나/ })
    expect(calls.find((c) => c.path === '/enrollments')?.query.get('status')).toBe('APPLIED,REVIEWING')
    expect(within(applied).getByRole('link', { name: '김하나' })).toHaveAttribute('href', '/trainees/1?course_id=3')
    expect(within(applied).getByText('1990-**-**')).toBeInTheDocument()
    expect(within(applied).getByRole('button', { name: '확인 착수' })).toBeInTheDocument()
    const reviewing = screen.getByRole('row', { name: /이두리/ })
    expect(within(reviewing).getByRole('button', { name: '확정' })).toBeInTheDocument()

    await user.click(within(applied).getByRole('button', { name: '반려/취소' }))
    const dialog = screen.getByRole('dialog', { name: '반려/취소' })
    await user.click(within(dialog).getByRole('button', { name: '반려/취소' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('사유를 입력해 주세요.')
    await user.type(within(dialog).getByRole('textbox'), '서류 미비')
    await user.click(within(dialog).getByRole('button', { name: '반려/취소' }))
    expect(await screen.findByText('김하나 — 반려/취소 처리했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/enrollments/50/reject')?.body).toEqual({ cancel_reason: '서류 미비' })
  })

  it('확정 탭 + 과정 선택 시 수료 판정 후보를 보여주고, 수료 처리는 사유 필수', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /enrollments': page([enrollment({ status: 'CONFIRMED' })]),
      'GET /courses/3/completion-candidates': { status: 200, body: { ready: true, threshold: 0.8, lateToAbsence: 3, items: [{ traineeId: 1, enrollmentId: 50, name: '김하나', attendanceRate: 0.625 }] } },
      'POST /enrollments/50/complete': { status: 200, body: {} },
    })
    const user = userEvent.setup()
    renderAt('/enrollments?tab=confirmed&course_id=3')
    const panel = await screen.findByRole('region', { name: '수료 판정 확인 후보' })
    expect(within(panel).getByRole('row', { name: '김하나 62.5%' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/enrollments')?.query.get('status')).toBe('CONFIRMED')

    const row = screen.getByRole('row', { name: /김하나 1990/ })
    await user.click(within(row).getByRole('button', { name: '수료' }))
    const dialog = screen.getByRole('dialog', { name: '수료' })
    expect(within(dialog).getByText(/되돌릴 수 없는 최종 상태/)).toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox'), '출석 기준 충족')
    await user.click(within(dialog).getByRole('button', { name: '수료' }))
    await waitFor(() => expect(calls.find((c) => c.path === '/enrollments/50/complete')?.body).toEqual({ reason: '출석 기준 충족' }))
  })

  it('조회 권한만 있으면(시스템 관리자) 처리 열이 없다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['SYS_ADMIN'] }, SYS_PERMISSIONS) },
      'GET /courses': courses,
      'GET /enrollments': page([enrollment()]),
    })
    renderAt('/enrollments')
    await screen.findByRole('row', { name: /김하나/ })
    expect(screen.queryByRole('columnheader', { name: '처리' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '훈련생 등록' })).not.toBeInTheDocument()
  })
})

describe('S03 훈련생 목록', () => {
  it('연락처 검색은 4자 이상, 목록은 마스킹 값, 성명은 과정 포함 상세 링크', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /trainees': page([{ enrollmentId: 50, traineeId: 1, name: '김하나', birthDate: '1990-**-**', contact: '***-****-5678', courseId: 3, courseName: '웹개발 1기', status: 'CONFIRMED', confirmedAt: '2026-09-02T00:00:00.000Z' }]),
    })
    const user = userEvent.setup()
    renderAt('/trainees')
    const row = await screen.findByRole('row', { name: /김하나/ })
    expect(within(row).getByText('***-****-5678')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '김하나' })).toHaveAttribute('href', '/trainees/1?course_id=3')
    await user.type(screen.getByLabelText('연락처(4자 이상)'), '567')
    await user.click(screen.getByRole('button', { name: '검색' }))
    expect(screen.getByRole('alert')).toHaveTextContent('4자 이상')
    expect(calls.filter((c) => c.path === '/trainees').every((c) => !c.query.has('contact'))).toBe(true)
    await user.type(screen.getByLabelText('연락처(4자 이상)'), '8')
    await user.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/trainees').at(-1)!.query.get('contact')).toBe('5678'))
  })
})

describe('S04 훈련생 등록', () => {
  it('같은 이름의 기존 훈련생을 골라 새 과정에 등록하고, 이미 등록돼 있으면 기존 건으로 안내', async () => {
    let exists = true
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /trainees/search': { status: 200, body: { items: [{ traineeId: 1, name: '김하나', birthDate: '1990-**-**', contact: '***-****-5678', enrollmentCount: 1 }] } },
      'POST /enrollments': () =>
        exists
          ? { status: 409, body: { statusCode: 409, code: 'ENROLLMENT_EXISTS', message: '이미 해당 과정에 등록된 훈련생입니다(등록 건 50, 상태 CONFIRMED).' } }
          : { status: 201, body: { trainee: { traineeId: 1 }, enrollment: { enrollmentId: 60 } } },
      'GET /trainees/1': { status: 200, body: traineeDetail() },
    })
    const user = userEvent.setup()
    renderAt('/trainees/new')
    await user.type(await screen.findByLabelText('성명(필수)'), '김하나')
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(calls.find((c) => c.path === '/trainees/search')?.query.get('name')).toBe('김하나')
    await user.click(await screen.findByRole('button', { name: '이 훈련생으로 등록' }))

    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('과정을 선택해 주세요.')
    await user.selectOptions(screen.getByLabelText('과정(필수)'), '3')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('link', { name: '기존 등록 건 보기' })).toHaveAttribute('href', '/trainees/1?course_id=3')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ course_id: 3, trainee_id: 1 })

    exists = false
    await user.selectOptions(screen.getByLabelText('과정(필수)'), '4')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('heading', { name: '김하나' })).toBeInTheDocument()
    expect(window.location.search).toBe('?course_id=4')
  })

  it('기존 인물이 없으면 신규 인물 정보와 함께 등록한다(신청일을 바꾸면 그날로 기록)', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /trainees/search': { status: 200, body: { items: [] } },
      'POST /enrollments': { status: 201, body: { trainee: { traineeId: 9 }, enrollment: { enrollmentId: 61 } } },
      'GET /trainees/9': { status: 200, body: traineeDetail({ traineeId: 9, name: '신규', enrollments: [] }) },
    })
    const user = userEvent.setup()
    renderAt('/trainees/new')
    await user.type(await screen.findByLabelText('성명(필수)'), '신규')
    await user.type(screen.getByLabelText('생년월일'), '1995-04-01')
    await user.type(screen.getByLabelText('연락처'), '010-1234-0000')
    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('신규 인물 신규을(를) 등록합니다.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('과정(필수)'), '4')
    await user.clear(screen.getByLabelText('신청일'))
    await user.type(screen.getByLabelText('신청일'), '2026-09-01')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('heading', { name: '신규' })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      course_id: 4,
      trainee: { name: '신규', birth_date: '1995-04-01', contact: '010-1234-0000' },
      applied_at: '2026-09-01T00:00:00+09:00',
    })
  })
})

describe('S05 훈련생 상세 / S04 수정', () => {
  it('등록 건을 골라 출결·결과물을 그 과정 기준으로 보고, 관련 확인 건 탭은 권한이 있을 때만', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /trainees/1': { status: 200, body: traineeDetail() },
      'GET /trainees/1/attendance-summary': ({ query }) => ({
        status: 200,
        body: {
          items:
            query.get('course_id') === '3'
              ? [
                  { scheduleId: 11, roundNo: 1, classDate: '2026-09-21', scheduleStatus: 'SCHEDULED', attendanceId: null, checkInTime: null, checkOutTime: null, displayStatus: 'NOT_CHECKED' },
                  { scheduleId: 12, roundNo: 2, classDate: '2026-09-22', scheduleStatus: 'CANCELLED', attendanceId: null, checkInTime: null, checkOutTime: null, displayStatus: null },
                ]
              : [],
        },
      }),
      'GET /trainees/1/verification-cases': { status: 200, body: { items: [{ caseId: 91, courseId: 3, courseName: '웹개발 1기', ruleCode: 'RULE_04', ruleName: '퇴실정보 누락', status: 'IN_REVIEW', detectedAt: '2026-09-28T01:00:00.000Z', closedAt: null, priority: false }] } },
    })
    const user = userEvent.setup()
    renderAt('/trainees/1')
    expect(await screen.findByText('***-****-5678')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '정보 수정' })).toHaveAttribute('href', '/trainees/1/edit')
    expect(screen.getByRole('link', { name: '변경이력 전체 보기' })).toHaveAttribute('href', '/trainee-change-logs?trainee_id=1')

    await user.click(screen.getByRole('tab', { name: '출결요약' }))
    const panel = screen.getByRole('tabpanel')
    expect(await within(panel).findByRole('row', { name: /1회차 2026-09-21 - - 미출결/ })).toBeInTheDocument()
    expect(within(panel).getByRole('row', { name: /2회차 2026-09-22 - - 휴강/ })).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('과정 선택'), '4')
    expect(await within(screen.getByRole('tabpanel')).findByText('등록된 회차가 없습니다.')).toBeInTheDocument()
    expect(calls.filter((c) => c.path === '/trainees/1/attendance-summary').map((c) => c.query.get('course_id'))).toEqual(['3', '4'])

    await user.click(screen.getByRole('tab', { name: '확인필요 관련이력' }))
    expect(await within(screen.getByRole('tabpanel')).findByRole('link', { name: '#91' })).toHaveAttribute('href', '/verification-cases/91')
  })

  it('강사: 수정·변경이력 링크와 확인필요 탭이 없다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) },
      'GET /trainees/1': { status: 200, body: traineeDetail({ enrollments: [traineeDetail().enrollments[0]] }) },
    })
    renderAt('/trainees/1')
    await screen.findByRole('tab', { name: '등록이력' })
    expect(screen.queryByRole('link', { name: '정보 수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '변경이력 전체 보기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '확인필요 관련이력' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('과정 선택')).not.toBeInTheDocument() // 등록 건이 하나면 선택 없이 표시
  })

  it('정보 수정은 바꾼 항목과 사유만 보낸다(마스킹 값은 채워 넣지 않음)', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /trainees/1': { status: 200, body: traineeDetail() },
      'PATCH /trainees/1': { status: 200, body: {} },
    })
    const user = userEvent.setup()
    renderAt('/trainees/1/edit')
    expect(await screen.findByLabelText('성명')).toHaveValue('김하나')
    expect(screen.getByLabelText('연락처(바꿀 때만 입력)')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('변경한 내용이 없습니다.')
    await user.type(screen.getByLabelText('연락처(바꿀 때만 입력)'), '010-2222-3333')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('수정 사유를 입력해 주세요.')
    await user.type(screen.getByLabelText('수정 사유(필수)'), '번호 변경')
    await user.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ contact: '010-2222-3333', reason: '번호 변경' }))
  })
})

describe('S06 훈련생 변경이력', () => {
  it('바뀐 필드만 전→후로 보여주고 훈련생명으로 검색한다', async () => {
    const log: TraineeChangeLog = {
      logId: 1,
      entityType: 'ENROLLMENT',
      entityId: 50,
      changedBy: 7,
      changedByName: '김운영',
      changedAt: '2026-09-02T00:00:00.000Z',
      beforeValue: { status: 'REVIEWING', updated_at: 'a' },
      afterValue: { status: 'CONFIRMED', updated_at: 'b' },
      reason: '대상자 확정',
      traineeId: 1,
      traineeName: '김하나',
      courseName: '웹개발 1기',
    }
    const { calls } = mockApi({ 'GET /auth/me': { status: 200, body: me() }, 'GET /trainee-change-logs': page([log]) })
    const user = userEvent.setup()
    renderAt('/trainee-change-logs?trainee_id=1')
    const row = await screen.findByRole('row', { name: /김하나/ })
    expect(within(row).getByText('서류확인중')).toBeInTheDocument()
    expect(within(row).getByText('확정')).toBeInTheDocument()
    expect(within(row).queryByText('a')).not.toBeInTheDocument() // 감사 컬럼 제외
    expect(screen.getByText(/특정 훈련생의 이력만/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('훈련생명'), '김')
    await user.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => {
      const q = calls.filter((c) => c.path === '/trainee-change-logs').at(-1)!.query
      expect(q.get('trainee_name')).toBe('김')
      expect(q.has('trainee_id')).toBe(false)
    })
  })

  it('diffFields: 값이 같은 필드·감사 컬럼은 제외하고 빈 값은 (없음)', () => {
    expect(diffFields({ contact: '***-****-1111', name: '가', updated_at: 'x' }, { contact: '***-****-2222', name: '가', updated_at: 'y' })).toEqual([
      { field: 'contact', label: '연락처', before: '***-****-1111', after: '***-****-2222' },
    ])
    expect(diffFields(null, { cancel_reason: '중복' })).toEqual([{ field: 'cancel_reason', label: '취소 사유', before: '(없음)', after: '중복' }])
    // 시각은 KST 표시, 사용자 ID 는 "사용자 #n"
    expect(diffFields({ confirmed_at: null, confirmed_by: null }, { confirmed_at: '2026-09-28T09:11:37.923Z', confirmed_by: 2 }).map((d) => d.after)).toEqual(['2026-09-28 18:11', '사용자 #2'])
  })
})
