import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'
import { dashboard, INSTRUCTOR_PERMISSIONS, me, mockApi } from './test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}

describe('인증 흐름', () => {
  it('세션이 없으면 로그인 화면으로 보내고, 로그인하면 원래 가려던 화면으로 돌아간다', async () => {
    let loggedIn = false
    const { calls } = mockApi({
      'GET /auth/me': () => (loggedIn ? { status: 200, body: me() } : { status: 401, body: { message: '로그인이 필요합니다.' } }),
      'POST /auth/login': ({ body }) => {
        const { password } = body as { password: string }
        if (password !== 'right-pass') return { status: 401, body: { statusCode: 401, message: '아이디 또는 비밀번호가 올바르지 않습니다.' } }
        loggedIn = true
        return { status: 200, body: { user: me().user } }
      },
      'GET /dashboard': { status: 200, body: dashboard() },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    const user = userEvent.setup()
    renderAt('/?course_id=3')

    await screen.findByRole('button', { name: '로그인' })
    await user.type(screen.getByLabelText('아이디'), 'ops1')
    await user.type(screen.getByLabelText('비밀번호'), 'wrong')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('아이디 또는 비밀번호가 올바르지 않습니다.')
    expect(screen.getByLabelText('비밀번호')).toHaveValue('')

    await user.type(screen.getByLabelText('비밀번호'), 'right-pass')
    await user.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    expect(window.location.search).toBe('?course_id=3')
    // 제목은 요청보다 먼저 그려질 수 있어 요청이 나갈 때까지 기다린다
    await waitFor(() => expect(calls.find((c) => c.path === '/dashboard')?.query.get('course_id')).toBe('3'))
  })

  it('초기 비밀번호 상태면 메뉴 없이 비밀번호 변경만 가능하고, 변경 후 대시보드로 간다', async () => {
    let mustChange = true
    const { calls } = mockApi({
      'GET /auth/me': () => ({ status: 200, body: me({ mustChangePassword: mustChange }) }),
      'POST /auth/change-password': () => {
        mustChange = false
        return { status: 200, body: { ok: true } }
      },
      'GET /dashboard': { status: 200, body: dashboard() },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    const user = userEvent.setup()
    renderAt('/courses')

    expect(await screen.findByRole('heading', { name: '비밀번호 변경' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('현재 비밀번호'), 'Temp-1234')
    await user.type(screen.getByLabelText(/^새 비밀번호 \(/), 'short')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'short')
    await user.click(screen.getByRole('button', { name: '변경' }))
    expect(screen.getByRole('alert')).toHaveTextContent('10자 이상')
    expect(calls.some((c) => c.path === '/auth/change-password')).toBe(false)

    await user.clear(screen.getByLabelText(/^새 비밀번호 \(/))
    await user.clear(screen.getByLabelText('새 비밀번호 확인'))
    await user.type(screen.getByLabelText(/^새 비밀번호 \(/), 'New-pass-1234')
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'New-pass-1234')
    await user.click(screen.getByRole('button', { name: '변경' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/auth/change-password')?.body).toEqual({ currentPassword: 'Temp-1234', newPassword: 'New-pass-1234' })
  })

  it('사용 중 세션이 만료되면(401) 로그인 화면으로 돌아가 안내한다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /dashboard': { status: 401, body: { message: '로그인이 필요합니다.' } },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    renderAt('/')
    expect(await screen.findByText('세션이 만료되었습니다. 다시 로그인해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument()
  })

  it('권한 없는 화면 주소로 직접 들어오면 안내를 보여준다', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'] }, INSTRUCTOR_PERMISSIONS) } })
    renderAt('/admin/audit-logs')
    expect(await screen.findByRole('heading', { name: '접근 권한 없음' })).toBeInTheDocument()
  })
})

describe('대시보드 (S01)', () => {
  it('불필요한 표시를 줄인다: 0건 업무는 처리할 업무 표에서 빠지고, 대상이 없는 확인 건 표는 대상 열을 숨기며, 상단 띠에 전체 건수 문구를 두지 않는다', async () => {
    const base = dashboard()
    const noTrainee = base.verificationSummary.recent.map((c) => ({ ...c, trainees: [] }))
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      // 결과물 미제출 0건, 조치 필요·추가 확인 0건, 확인 건 상태는 확인필요 하나뿐
      'GET /dashboard': { status: 200, body: dashboard({ verificationSummary: { byStatus: [{ status: 'NEEDS_CHECK', count: 2 }], recent: noTrainee } }) },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    renderAt('/')
    const todo = await screen.findByRole('region', { name: '우선 처리 업무' })
    expect(within(todo).getByRole('row', { name: /미출결 4 / })).toBeInTheDocument()
    expect(within(todo).queryByRole('row', { name: /결과물 미제출/ })).not.toBeInTheDocument()
    expect(within(todo).queryByRole('row', { name: /조치 필요·추가 확인 사항/ })).not.toBeInTheDocument()
    const cases = screen.getByRole('region', { name: '확인 필요 사항' })
    expect(within(cases).queryByRole('columnheader', { name: '대상' })).not.toBeInTheDocument()
    expect(within(cases).getByRole('columnheader', { name: '탐지유형' })).toBeInTheDocument()
    const band = screen.getByRole('region', { name: '오늘 운영 상태' })
    expect(within(band).queryByText(/전체 \d+건 중/)).not.toBeInTheDocument()
  })

  it('확인 건 상태가 둘 이상이면 상태 구성 막대를 보여주고, 대상이 있는 건이 있으면 대상 열을 보여준다', async () => {
    const base = dashboard()
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /dashboard': { status: 200, body: dashboard({ verificationSummary: { byStatus: [{ status: 'NEEDS_CHECK', count: 2 }, { status: 'IN_REVIEW', count: 1 }], recent: base.verificationSummary.recent } }) },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    renderAt('/')
    const band = await screen.findByRole('region', { name: '오늘 운영 상태' })
    expect(within(band).getByRole('group', { name: '확인 건 처리 현황' })).toBeInTheDocument()
    const cases = screen.getByRole('region', { name: '확인 필요 사항' })
    expect(within(cases).getByRole('columnheader', { name: '대상' })).toBeInTheDocument()
  })

  it('같은 발생일시·과정의 확인 건은 대표 한 줄로 묶고 펼치면 개별 건을 보여준다', async () => {
    const base = dashboard()
    const one = base.verificationSummary.recent[0]
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /dashboard': { status: 200, body: dashboard({ verificationSummary: { byStatus: base.verificationSummary.byStatus, recent: [one, { ...one, caseId: 92 }, { ...one, caseId: 93 }] } }) },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    const user = userEvent.setup()
    renderAt('/')
    const cases = await screen.findByRole('region', { name: '확인 필요 사항' })
    const toggle = within(cases).getByRole('button', { name: /외 2건 펼치기/ })
    expect(within(cases).queryByRole('link', { name: /2026-09-28/ })).not.toBeInTheDocument()
    await user.click(toggle)
    expect(within(cases).getAllByRole('link', { name: '2026-09-28 10:05' })).toHaveLength(3)
  })

  it('오늘 회차·확인 필요 요약·미처리 건수를 표로 보여준다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /dashboard': { status: 200, body: dashboard() },
      'GET /courses': { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }], page: 1, size: 100, total: 1 } },
    })
    renderAt('/')

    const today = await screen.findByRole('region', { name: '2026-09-28 회차' })
    expect(within(today).getByRole('link', { name: '웹개발 1기' })).toHaveAttribute('href', '/courses/3')
    expect(within(today).getByText(/09:00~18:00/)).toBeInTheDocument()

    const cases = screen.getByRole('region', { name: '확인 필요 사항' })
    expect(within(cases).getByRole('link', { name: '2026-09-28 10:05' })).toHaveAttribute('href', '/verification-cases/91')
    expect(within(cases).getByText('가 외 2명')).toBeInTheDocument()
    expect(within(cases).getByText('동일 환경 복수 출결')).toBeInTheDocument()
    expect(within(cases).getByText('미지정')).toBeInTheDocument()

    const pending = screen.getByRole('region', { name: '우선 처리 업무' })
    expect(within(pending).getByRole('row', { name: /미출결 4 / })).toBeInTheDocument()
    expect(within(pending).getByRole('row', { name: /결과물 미검토 3 / })).toBeInTheDocument()
    expect(within(pending).getByRole('row', { name: /확인 필요 사항 2 / })).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: '주 메뉴' })
    expect(within(nav).getByRole('link', { name: '확인 필요 목록' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: '감사로그' })).not.toBeInTheDocument()
  })

  it('필터(과정·내 담당)는 조회 조건과 URL 에 반영된다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /dashboard': { status: 200, body: dashboard() },
      'GET /courses': { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }], page: 1, size: 100, total: 1 } },
    })
    const user = userEvent.setup()
    renderAt('/')
    await screen.findByRole('option', { name: '웹개발 1기' })

    await user.selectOptions(screen.getByLabelText('과정'), '3')
    await user.click(screen.getByLabelText('내 담당 건만'))
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/dashboard').at(-1)!
      expect(last.query.get('course_id')).toBe('3')
      expect(last.query.get('assignee_id')).toBe('7')
    })
    expect(new URLSearchParams(window.location.search).get('mine')).toBe('1')
  })

  it('강사: 내 담당 필터·확인 건 상세 링크가 없고, 빈 데이터는 텍스트로 안내한다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) },
      'GET /dashboard': { status: 200, body: dashboard({ todaySchedules: [], verificationSummary: { byStatus: [], recent: dashboard().verificationSummary.recent } }) },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    renderAt('/')
    expect(await screen.findByText('오늘 예정된 교육이 없습니다.')).toBeInTheDocument()
    expect(screen.queryByLabelText('내 담당 건만')).not.toBeInTheDocument()
    const cases = screen.getByRole('region', { name: '확인 필요 사항' })
    expect(within(cases).queryByRole('link')).not.toBeInTheDocument()
  })

  it('좌측 메뉴는 그룹별로 접고 펼 수 있다(현재 화면이 속한 그룹은 항상 펼침)', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /dashboard': { status: 200, body: dashboard() },
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    window.localStorage.clear()
    const user = userEvent.setup()
    renderAt('/')
    const nav = await screen.findByRole('navigation', { name: '주 메뉴' })
    const toggle = within(nav).getByRole('button', { name: '출결 관리' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: '일일 출결' })).toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('조회 실패 시 오류와 다시 시도를 보여준다', async () => {
    let fail = true
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /dashboard': () => (fail ? { status: 500, body: { statusCode: 500, message: 'Internal server error' } } : { status: 200, body: dashboard() }),
      'GET /courses': { status: 200, body: { items: [], page: 1, size: 100, total: 0 } },
    })
    const user = userEvent.setup()
    renderAt('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류가 발생했습니다')
    fail = false
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('region', { name: '2026-09-28 회차' })).toBeInTheDocument()
  })
})
