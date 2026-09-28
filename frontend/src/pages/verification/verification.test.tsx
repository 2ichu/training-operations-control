import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { VerificationCaseDetail, VerificationCaseListItem } from '../../api/types'
import { me, mockApi, OPS_PERMISSIONS, SYS_PERMISSIONS } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const courses = { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }], page: 1, size: 100, total: 1 } }

const listItem = (overrides: Partial<VerificationCaseListItem> = {}): VerificationCaseListItem => ({
  caseId: 91,
  courseId: 3,
  courseName: '웹개발 1기',
  ruleCode: 'RULE_01',
  ruleName: '동일 환경 복수 출결',
  detectedAt: '2026-09-28T01:05:00.000Z',
  status: 'PRIORITY_CHECK',
  assigneeId: null,
  assigneeName: null,
  closedAt: null,
  priority: true,
  trainees: [
    { traineeId: 1, name: '가' },
    { traineeId: 2, name: '나' },
    { traineeId: 3, name: '다' },
  ],
  ...overrides,
})

const detail = (overrides: Partial<VerificationCaseDetail> = {}): VerificationCaseDetail => ({
  caseId: 91,
  courseId: 3,
  courseName: '웹개발 1기',
  ruleCode: 'RULE_01',
  ruleName: '동일 환경 복수 출결',
  detectedAt: '2026-09-28T01:05:00.000Z',
  evidence: { dedupe_key: '3:11:dev-1', items: [{ id: '3:11:dev-1', schedule_id: 11, device_id: 'dev-1', trainee_ids: [1, 2] }] },
  status: 'NEEDS_CHECK',
  assigneeId: null,
  assigneeName: null,
  confirmationNote: null,
  actionNote: null,
  closedAt: null,
  priority: false,
  trainees: [
    { traineeId: 1, name: '가', attendanceId: 501 },
    { traineeId: 2, name: '나', attendanceId: null },
  ],
  schedules: [{ scheduleId: 11, roundNo: 5, classDate: '2026-09-28' }],
  relatedCourseIssue: null,
  relatedOperationLog: null,
  actionLogs: [],
  ...overrides,
})

describe('S22 확인 필요 목록', () => {
  it('기본은 진행중 상태만 조회하고, 필터·상태 선택은 조회 조건에 반영된다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /verification-cases': { status: 200, body: { items: [listItem()], page: 1, size: 20, total: 1 } },
    })
    const user = userEvent.setup()
    renderAt('/verification-cases')

    const row = await screen.findByRole('row', { name: /#91/ })
    expect(within(row).getByText('가 외 2명')).toBeInTheDocument()
    expect(within(row).getByText('우선')).toBeInTheDocument()
    expect(within(row).getByText('미지정')).toBeInTheDocument()
    const lastQuery = () => calls.filter((c) => c.path === '/verification-cases').at(-1)!.query
    expect(lastQuery().get('status')).toBe('NEEDS_CHECK,PRIORITY_CHECK,IN_REVIEW,ACTION_REQUIRED,FOLLOW_UP')

    await user.selectOptions(screen.getByLabelText('탐지유형'), 'MANUAL')
    await user.click(screen.getByRole('checkbox', { name: '조치완료' }))
    await waitFor(() => {
      expect(lastQuery().get('rule_code')).toBe('MANUAL')
      expect(lastQuery().get('status')?.split(',')).toContain('ACTION_DONE')
    })

    await user.click(screen.getByRole('button', { name: '전체' }))
    await waitFor(() => expect(lastQuery().has('status')).toBe(false))
    expect(screen.getByRole('checkbox', { name: '확인필요' })).not.toBeChecked()

    await user.type(screen.getByLabelText('훈련생명'), '홍길동')
    await user.click(screen.getByRole('button', { name: '검색' }))
    await waitFor(() => expect(lastQuery().get('trainee_name')).toBe('홍길동'))
  })

  it('선택한 건을 나에게 배정한다', async () => {
    let assigned = false
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /verification-cases': () => ({ status: 200, body: { items: [listItem(assigned ? { assigneeId: 7, assigneeName: '김운영' } : {})], page: 1, size: 20, total: 1 } }),
      'POST /verification-cases/assign': () => {
        assigned = true
        return { status: 200, body: { updated: 1, notFound: [] } }
      },
    })
    const user = userEvent.setup()
    renderAt('/verification-cases')

    await screen.findByRole('row', { name: /#91/ })
    expect(screen.getByRole('button', { name: '선택 0건 나에게 배정' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: '사건 91 선택' }))
    await user.click(screen.getByRole('button', { name: '선택 1건 나에게 배정' }))
    expect(await screen.findByText('1건을 나에게 배정했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/verification-cases/assign')?.body).toEqual({ case_ids: [91], assignee_id: 7 })
    expect(await screen.findByRole('cell', { name: '김운영' })).toBeInTheDocument()
  })

  it('조회 권한만 있으면(시스템 관리자) 선택·배정 기능이 없다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['SYS_ADMIN'] }, SYS_PERMISSIONS) },
      'GET /courses': courses,
      'GET /verification-cases': { status: 200, body: { items: [listItem()], page: 1, size: 20, total: 1 } },
    })
    renderAt('/verification-cases')
    await screen.findByRole('row', { name: /#91/ })
    expect(screen.queryByRole('checkbox', { name: '사건 91 선택' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /나에게 배정/ })).not.toBeInTheDocument()
  })
})

describe('S23 확인 필요 상세', () => {
  it('탐지 근거를 사실 그대로(회차·기기·훈련생 이름) 보여주고, 상태별 처리 폼으로 전이한다', async () => {
    let current = detail()
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /verification-cases/91': () => ({ status: 200, body: current }),
      'POST /verification-cases/91/start-review': ({ body }) => {
        current = detail({
          status: 'IN_REVIEW',
          confirmationNote: (body as { confirmation_note: string }).confirmation_note,
          actionLogs: [{ logId: 1, actorId: 7, actorName: '김운영', actionAt: '2026-09-28T02:00:00.000Z', actionType: 'CHECK', previousStatus: 'NEEDS_CHECK', newStatus: 'IN_REVIEW', note: '근거 확인' }],
        })
        return { status: 200, body: { status: 'IN_REVIEW' } }
      },
    })
    const user = userEvent.setup()
    renderAt('/verification-cases/91')

    const evidence = await screen.findByRole('region', { name: '탐지 근거' })
    expect(within(evidence).getByText('5회차 (2026-09-28)')).toBeInTheDocument()
    expect(within(evidence).getByText('dev-1')).toBeInTheDocument()
    expect(within(evidence).getByText('가, 나')).toBeInTheDocument()
    expect(within(evidence).queryByText('3:11:dev-1')).not.toBeInTheDocument() // 병합용 내부 id 는 숨김
    const trainees = screen.getByRole('region', { name: '관련 훈련생' })
    expect(within(trainees).getByRole('row', { name: '가 출결 #501' })).toBeInTheDocument()
    expect(screen.getByText('아직 처리 이력이 없습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '확인 시작' }))
    expect(screen.getByRole('alert')).toHaveTextContent('확인내용을(를) 입력해 주세요.')
    expect(calls.some((c) => c.method === 'POST')).toBe(false)

    await user.type(screen.getByLabelText('확인내용'), '근거 확인')
    await user.click(screen.getByRole('button', { name: '확인 시작' }))
    expect(await screen.findByRole('button', { name: '확인 완료 종결' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '조치 필요로 전환' })).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ confirmation_note: '근거 확인' })
    const history = screen.getByRole('region', { name: '처리이력' })
    expect(within(history).getByRole('row', { name: /김운영 확인 시작 확인필요 → 확인중 근거 확인/ })).toBeInTheDocument()
  })

  it('다른 사용자가 먼저 처리했으면(409) 안내 후 최신 상태로 다시 불러온다', async () => {
    let current = detail({ status: 'IN_REVIEW' })
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /verification-cases/91': () => ({ status: 200, body: current }),
      'POST /verification-cases/91/complete-confirmation': () => {
        current = detail({ status: 'CONFIRMED', closedAt: '2026-09-28T03:00:00.000Z' })
        return { status: 409, body: { statusCode: 409, code: 'INVALID_STATE_TRANSITION', message: '현재 상태(CONFIRMED)에서는 처리할 수 없습니다.' } }
      },
    })
    const user = userEvent.setup()
    renderAt('/verification-cases/91')
    await user.click(await screen.findByRole('button', { name: '확인 완료 종결' }))
    expect(await screen.findByText(/다른 사용자가 먼저 처리해/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '재오픈(추가확인)' })).toBeInTheDocument()
  })

  it('조회 권한만 있으면 처리 폼이 없고, 없는 사건은 안내한다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['SYS_ADMIN'] }, SYS_PERMISSIONS) },
      'GET /verification-cases/91': { status: 200, body: detail() },
      'GET /verification-cases/92': { status: 404, body: { statusCode: 404, message: '대상을 찾을 수 없습니다.' } },
    })
    const { unmount } = renderAt('/verification-cases/91')
    await screen.findByRole('region', { name: '탐지 근거' })
    expect(screen.queryByRole('button', { name: '확인 시작' })).not.toBeInTheDocument()
    unmount()
    renderAt('/verification-cases/92')
    expect(await screen.findByRole('heading', { name: '페이지를 찾을 수 없습니다' })).toBeInTheDocument()
  })
})

describe('S24 조치이력', () => {
  it('이력을 표로 보여주고 처리 유형 필터를 조회 조건에 반영한다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me({}, OPS_PERMISSIONS) },
      'GET /courses': courses,
      'GET /verification-action-logs': {
        status: 200,
        body: {
          items: [{ logId: 5, caseId: 91, courseId: 3, courseName: '웹개발 1기', actorId: 7, actorName: '김운영', actionAt: '2026-09-28T02:00:00.000Z', actionType: 'REOPEN', previousStatus: 'CONFIRMED', newStatus: 'FOLLOW_UP', note: '추가 제보' }],
          page: 1,
          size: 50,
          total: 1,
        },
      },
    })
    const user = userEvent.setup()
    renderAt('/verification-action-logs')
    const row = await screen.findByRole('row', { name: /#91/ })
    expect(within(row).getByText('재오픈')).toBeInTheDocument()
    expect(within(row).getByText('확인완료 → 추가확인')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('처리 유형'), 'CLOSE')
    await waitFor(() => expect(calls.filter((c) => c.path === '/verification-action-logs').at(-1)!.query.get('action_type')).toBe('CLOSE'))
  })
})
