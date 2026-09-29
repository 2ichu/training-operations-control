import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { InstructorChangeLog, InstructorDetail, InstructorListItem } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const page = <T,>(items: T[]) => ({ status: 200, body: { items, page: 1, size: 20, total: items.length } })

const instructor = (overrides: Partial<InstructorListItem> = {}): InstructorListItem => ({
  instructorId: 2,
  name: '박강사',
  contact: '***-****-2222',
  status: 'ACTIVE',
  assignedCourseCount: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: null,
  ...overrides,
})
const detail = (overrides: Partial<InstructorDetail> = {}): InstructorDetail => {
  const { assignedCourseCount: _c, ...base } = instructor()
  return { ...base, linkedAccount: { userId: 9, loginId: 'ins1', name: '박강사', status: 'ACTIVE' }, ...overrides }
}
const insMe = () => me({ userId: 9, loginId: 'ins1', name: '박강사', roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS)

describe('S11 강사 목록', () => {
  it('성명·상태 검색, 마스킹 연락처·담당 과정 수, 운영담당자는 신규 등록·배정 관리 버튼', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /instructors': page([instructor(), instructor({ instructorId: 3, name: '이강사', status: 'INACTIVE', assignedCourseCount: 0, contact: null })]),
    })
    const user = userEvent.setup()
    renderAt('/instructors')
    const row = await screen.findByRole('row', { name: /박강사/ })
    expect(within(row).getByText('***-****-2222')).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: '박강사' })).toHaveAttribute('href', '/instructors/2')
    expect(within(row).getByRole('link', { name: '강의 일정' })).toHaveAttribute('href', '/schedules?instructor_id=2')
    expect(within(screen.getByRole('row', { name: /이강사/ })).getByText('비활동')).toHaveClass('badge-muted')
    expect(screen.getByRole('link', { name: '신규 등록' })).toHaveAttribute('href', '/instructors/new')
    expect(screen.getByRole('link', { name: '배정 관리' })).toHaveAttribute('href', '/schedules')

    await user.type(screen.getByLabelText('성명'), '박')
    await user.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(calls.at(-1)?.query.get('name')).toBe('박'))
    await user.selectOptions(screen.getByLabelText('상태'), '비활동')
    await waitFor(() => expect(calls.at(-1)?.query.get('status')).toBe('INACTIVE'))
  })

  it('강사 계정: 등록 버튼 없음(서버가 본인만 준다)', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: insMe() }, 'GET /instructors': page([instructor()]) })
    renderAt('/instructors')
    await screen.findByRole('row', { name: /박강사/ })
    expect(screen.queryByRole('link', { name: '신규 등록' })).not.toBeInTheDocument()
  })
})

describe('S12 강사 등록/수정', () => {
  it('등록: 성명 필수, 저장하면 상세로 이동', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'POST /instructors': { status: 201, body: instructor({ instructorId: 5, name: '신규' }) },
      'GET /instructors/5': { status: 200, body: detail({ instructorId: 5, name: '신규', linkedAccount: null }) },
    })
    const user = userEvent.setup()
    renderAt('/instructors/new')
    await user.click(await screen.findByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('성명을 입력해 주세요.')
    await user.type(screen.getByLabelText('성명(필수)'), '신규')
    await user.type(screen.getByLabelText('연락처'), '010-1234-5678')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('heading', { name: '신규' })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: '신규', contact: '010-1234-5678', status: 'ACTIVE' })
  })

  it('상세: 연결 계정은 읽기전용, 수정은 바꾼 필드 + 사유만 전송, 비활동 전환 시 남은 배정 경고', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /instructors/2': { status: 200, body: detail() },
      'PATCH /instructors/2': { status: 200, body: { ...detail(), status: 'INACTIVE', warnings: { inProgressAssignmentCount: 1 } } },
    })
    const user = userEvent.setup()
    renderAt('/instructors/2')
    expect(await screen.findByText('ins1 (박강사, 활성)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '변경이력 보기' })).toHaveAttribute('href', '/instructor-change-logs?instructor_id=2')
    await user.click(screen.getByRole('button', { name: '수정' }))
    expect(screen.getByText('현재: ***-****-2222')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('상태'), '비활동')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByRole('alert')).toHaveTextContent('수정 사유를 입력해 주세요.')
    await user.type(screen.getByLabelText('수정 사유(필수)'), '계약 종료')
    await user.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText(/진행 중인 과정의 배정 1건이 남아 있습니다/)).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'INACTIVE', reason: '계약 종료' })
  })

  it('강사 계정은 본인 상세를 조회만 한다(수정·변경이력 링크 없음)', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: insMe() }, 'GET /instructors/2': { status: 200, body: detail() } })
    renderAt('/instructors/2')
    await screen.findByRole('heading', { name: '박강사' })
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '변경이력 보기' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '강의 일정 보기' })).toBeInTheDocument()
  })
})

describe('S14 강사 변경이력', () => {
  it('강사 정보·배정 이력을 대상(과정·회차 범위)과 전 → 후로 보여준다', async () => {
    const logs: InstructorChangeLog[] = [
      {
        logId: 2,
        entityType: 'ASSIGNMENT',
        entityId: 40,
        changedBy: 7,
        changedByName: '김운영',
        changedAt: '2026-09-28T01:00:00.000Z',
        beforeValue: { status: 'ASSIGNED', round_no: 5 },
        afterValue: { status: 'CANCELLED', round_no: 5 },
        reason: '일정 충돌',
        instructorId: 2,
        instructorName: '박강사',
        courseId: 3,
        courseName: '웹개발 1기',
        roundNo: 5,
      },
      {
        logId: 1,
        entityType: 'INSTRUCTOR',
        entityId: 2,
        changedBy: 7,
        changedByName: '김운영',
        changedAt: '2026-09-27T01:00:00.000Z',
        beforeValue: { status: 'ACTIVE', contact: '***-****-2222' },
        afterValue: { status: 'INACTIVE', contact: '***-****-2222' },
        reason: '계약 종료',
        instructorId: 2,
        instructorName: '박강사',
        courseId: null,
        courseName: null,
        roundNo: null,
      },
    ]
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /instructors': page([instructor()]),
      'GET /instructor-change-logs': page(logs),
    })
    renderAt('/instructor-change-logs?instructor_id=2')
    const assignment = await screen.findByRole('row', { name: /일정 충돌/ })
    expect(assignment).toHaveTextContent('강사 배정')
    expect(assignment).toHaveTextContent('박강사 · 웹개발 1기 5회차')
    expect(assignment).toHaveTextContent('상태 배정 → 배정 취소')
    const info = screen.getByRole('row', { name: /계약 종료/ })
    expect(info).toHaveTextContent('상태 활동 → 비활동')
    expect(info).not.toHaveTextContent('연락처') // 바뀌지 않은 필드는 보이지 않는다
    expect(calls.find((c) => c.path === '/instructor-change-logs')?.query.get('instructor_id')).toBe('2')
    await waitFor(() => expect(screen.getByLabelText('강사')).toHaveDisplayValue('박강사'))
  })
})
