import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { ExcuseRequestDetail, ExcuseRequestSummary } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi, SYS_PERMISSIONS } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const courses = { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }], page: 1, size: 100, total: 1 } }

const summary = (overrides: Partial<ExcuseRequestSummary> = {}): ExcuseRequestSummary => ({
  requestId: 7,
  traineeId: 3,
  traineeName: '김하나',
  courseId: 3,
  courseName: '웹개발 1기',
  scheduleId: 11,
  roundNo: 2,
  classDate: '2026-09-28',
  reasonType: 'MEDICAL',
  status: 'PENDING',
  requestedAt: '2026-09-28T01:00:00.000Z',
  decidedAt: null,
  evidenceCount: 1,
  ...overrides,
})
const detail = (overrides: Partial<ExcuseRequestDetail> = {}): ExcuseRequestDetail => ({
  ...summary(),
  reasonNote: '병원 진료',
  requestedByName: '김운영',
  decidedByName: null,
  decisionNote: null,
  attendanceId: null,
  currentAttendanceStatus: null,
  evidence: [{ evidenceId: 70, fileName: '진단서.png', fileSize: 2048, mimeType: 'image/png', uploadedAt: '2026-09-28T01:01:00.000Z' }],
  ...overrides,
})
const list = (items: ExcuseRequestSummary[]) => ({ status: 200, body: { items, page: 1, size: 20, total: items.length } })

describe('S30 공결 신청·승인', () => {
  it('왼쪽 목록에서 신청을 고르면 오른쪽에 증빙과 처리 화면이 나오고, 승인하면 API 를 호출하고 안내한다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /excuse-requests': list([summary(), summary({ requestId: 8, traineeName: '이둘', evidenceCount: 0 })]),
      'GET /excuse-requests/7': { status: 200, body: detail() },
      'POST /excuse-requests/7/approve': { status: 201, body: { requestId: 7, status: 'APPROVED' } },
    })
    const user = userEvent.setup()
    renderAt('/excuse-requests')
    expect(await screen.findByRole('heading', { name: '공결 신청·승인' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/excuse-requests')?.query.get('status')).toBe('PENDING')
    const panel = await screen.findByLabelText('신청 상세')
    expect(await within(panel).findByRole('heading', { name: /김하나 · 2026-09-28 2회차/ })).toBeInTheDocument()
    expect(within(panel).getByRole('tab', { name: /진단서\.png/ })).toHaveAttribute('aria-selected', 'true')
    await user.type(within(panel).getByLabelText('처리 메모(반려 시 필수)'), '진단서 확인')
    await user.click(within(panel).getByRole('button', { name: '승인' }))
    expect(await screen.findByText('승인했습니다. 해당 회차 출결이 인정결석으로 바뀌었습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/excuse-requests/7/approve')?.body).toEqual({ decision_note: '진단서 확인' })
  })

  it('반려는 사유가 없으면 API 를 부르지 않고, 증빙이 없는 신청은 승인 버튼이 막힌다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /excuse-requests': list([summary({ evidenceCount: 0 })]),
      'GET /excuse-requests/7': { status: 200, body: detail({ evidence: [] }) },
      'POST /excuse-requests/7/reject': { status: 201, body: { requestId: 7, status: 'REJECTED' } },
    })
    const user = userEvent.setup()
    renderAt('/excuse-requests')
    const panel = await screen.findByLabelText('신청 상세')
    expect(await within(panel).findByText('첨부된 증빙서류가 없습니다. 증빙이 없으면 승인할 수 없습니다.')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: '승인' })).toBeDisabled()
    await user.click(within(panel).getByRole('button', { name: '반려' }))
    expect(await within(panel).findByText('반려 사유를 입력해 주세요.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/excuse-requests/7/reject')).toBe(false)
    await user.type(within(panel).getByLabelText('처리 메모(반려 시 필수)'), '증빙 불충분')
    await user.click(within(panel).getByRole('button', { name: '반려' }))
    await waitFor(() => expect(calls.find((c) => c.path === '/excuse-requests/7/reject')?.body).toEqual({ decision_note: '증빙 불충분' }))
  })

  it('조회 전용 역할(SYS)은 처리·등록 버튼이 없고, 강사는 권한이 있으면 등록·처리할 수 있다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['SYS_ADMIN'] }, [...SYS_PERMISSIONS, { screenId: 'S30', action: 'R', scope: 'ALL' }]) },
      'GET /courses': courses,
      'GET /excuse-requests': list([summary()]),
      'GET /excuse-requests/7': { status: 200, body: detail() },
    })
    renderAt('/excuse-requests')
    const panel = await screen.findByLabelText('신청 상세')
    await within(panel).findByRole('heading', { name: /김하나/ })
    expect(screen.queryByRole('button', { name: '공결 신청 등록' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
  })

  it('S30 권한이 없으면 화면과 메뉴가 보이지 않는다', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS.filter((p) => p.screenId !== 'S30')) } })
    renderAt('/excuse-requests')
    await screen.findByRole('navigation')
    expect(screen.queryByRole('link', { name: '공결 신청·승인' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '공결 신청·승인' })).not.toBeInTheDocument()
  })
})
