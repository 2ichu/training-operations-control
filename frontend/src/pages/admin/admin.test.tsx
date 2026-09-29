import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { AuditLogEntry, DetectionRule, RoleGrant, UserAccount } from '../../api/types'
import { grants, me, mockApi, OPS_PERMISSIONS, SYS_PERMISSIONS } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const page = <T,>(items: T[]) => ({ status: 200, body: { items, page: 1, size: 20, total: items.length } })
const sysMe = () => me({ userId: 1, loginId: 'admin', name: '관리자', roles: ['SYS_ADMIN'] }, SYS_PERMISSIONS)

const user = (overrides: Partial<UserAccount> = {}): UserAccount => ({
  userId: 5,
  loginId: 'ins1',
  name: '박강사',
  email: null,
  linkedInstructorId: 2,
  status: 'ACTIVE',
  mustChangePassword: false,
  roleCode: 'INSTRUCTOR',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: null,
  ...overrides,
})
const instructors = page([
  { instructorId: 2, name: '박강사', contact: null, status: 'ACTIVE', assignedCourseCount: 1, createdAt: '', updatedAt: null },
  { instructorId: 3, name: '이강사', contact: null, status: 'ACTIVE', assignedCourseCount: 0, createdAt: '', updatedAt: null },
])

describe('S25 사용자', () => {
  it('등록: 강사 역할은 연결 강사 필수, 저장하면 임시 비밀번호를 한 번 보여 준다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: sysMe() },
      'GET /users': page([user()]),
      'GET /instructors': instructors,
      'POST /users': { status: 201, body: { ...user({ userId: 6, loginId: 'ins2', name: '이강사', linkedInstructorId: 3, mustChangePassword: true }), tempPassword: 'Tmp-9f2k-x8Q' } },
    })
    const u = userEvent.setup()
    renderAt('/admin/users')
    const row = await screen.findByRole('row', { name: /ins1/ })
    await waitFor(() => expect(row).toHaveTextContent('박강사')) // 연결 강사 이름
    await u.click(screen.getByRole('button', { name: '사용자 등록' }))
    const dialog = screen.getByRole('dialog', { name: '사용자 등록' })
    await u.type(within(dialog).getByLabelText('로그인ID'), 'ins2')
    await u.type(within(dialog).getByLabelText('이름'), '이강사')
    await u.selectOptions(within(dialog).getByLabelText('역할'), '강사')
    await u.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('강사 역할은 연결할 강사를 선택해야 합니다.')
    await u.selectOptions(within(dialog).getByLabelText('연결 강사'), '이강사')
    await u.click(within(dialog).getByRole('button', { name: '저장' }))
    const temp = await screen.findByRole('dialog', { name: '임시 비밀번호' })
    expect(within(temp).getByLabelText('임시 비밀번호 값')).toHaveTextContent('Tmp-9f2k-x8Q')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ login_id: 'ins2', name: '이강사', role: 'INSTRUCTOR', linked_instructor_id: 3 })
    await u.click(within(temp).getByRole('button', { name: '확인' }))
    expect(screen.queryByText('Tmp-9f2k-x8Q')).not.toBeInTheDocument()
  })

  it('수정은 바뀐 필드만(다른 역할로 바꾸면 연결 강사 해제), 마지막 관리자 409 는 서버 안내를 보여 준다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: sysMe() },
      'GET /users': page([user(), user({ userId: 1, loginId: 'admin', name: '관리자', roleCode: 'SYS_ADMIN', linkedInstructorId: null })]),
      'GET /instructors': instructors,
      'PATCH /users/5': { status: 200, body: user({ roleCode: 'OPS_MANAGER', linkedInstructorId: null }) },
      'PATCH /users/1': { status: 409, body: { code: 'LAST_ADMIN', message: '마지막 활성 시스템 관리자는 비활성화하거나 역할을 바꿀 수 없습니다.' } },
    })
    const u = userEvent.setup()
    renderAt('/admin/users')
    await u.click(await screen.findByRole('button', { name: 'ins1 수정' }))
    let dialog = screen.getByRole('dialog', { name: '사용자 수정' })
    expect(within(dialog).getByLabelText('로그인ID')).toBeDisabled()
    await u.selectOptions(within(dialog).getByLabelText('역할'), '과정 운영 담당자')
    await u.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('박강사 계정을 수정했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/users/5')?.body).toEqual({ role: 'OPS_MANAGER', linked_instructor_id: null })

    await u.click(screen.getByRole('button', { name: 'admin 수정' }))
    dialog = screen.getByRole('dialog', { name: '사용자 수정' })
    await u.selectOptions(within(dialog).getByLabelText('상태'), '비활성')
    await u.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('마지막 활성 시스템 관리자는')
  })

  it('비밀번호 초기화 → 새 임시 비밀번호 1회 표시', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: sysMe() },
      'GET /users': page([user()]),
      'GET /instructors': instructors,
      'POST /users/5/reset-password': { status: 200, body: { tempPassword: 'Reset-77aa' } },
    })
    const u = userEvent.setup()
    renderAt('/admin/users')
    await u.click(await screen.findByRole('button', { name: 'ins1 비밀번호 초기화' }))
    await u.click(within(screen.getByRole('dialog', { name: '비밀번호 초기화' })).getByRole('button', { name: '초기화' }))
    expect(await screen.findByText('Reset-77aa')).toBeInTheDocument()
    expect(screen.getByText('ins1의 비밀번호를 초기화했습니다.')).toBeInTheDocument()
  })

  it('시스템 관리자가 아니면 들어올 수 없다', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: me({}, OPS_PERMISSIONS) } })
    renderAt('/admin/users')
    expect(await screen.findByRole('heading', { name: '접근 권한 없음' })).toBeInTheDocument()
  })
})

describe('S26 권한', () => {
  it('역할별 매트릭스, 바꾼 칸만 표시하고 저장은 역할 전체 교체(범위 포함), 잠금 방지 409 안내', async () => {
    const instructorGrants: RoleGrant[] = [
      { screenId: 'S01', action: 'R', scope: 'OWN_ASSIGNED' },
      { screenId: 'S05', action: 'R', scope: 'OWN_ASSIGNED' },
    ]
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: sysMe() },
      'GET /roles': {
        status: 200,
        body: {
          items: [
            { roleId: 1, roleCode: 'SYS_ADMIN', roleName: '시스템 관리자' },
            { roleId: 3, roleCode: 'INSTRUCTOR', roleName: '강사' },
          ],
        },
      },
      'GET /roles/permissions': (call) =>
        call.query.get('role_id') === '3'
          ? { status: 200, body: { roleId: 3, roleCode: 'INSTRUCTOR', items: instructorGrants } }
          : { status: 200, body: { roleId: 1, roleCode: 'SYS_ADMIN', items: [{ screenId: 'S26', action: 'R', scope: 'ALL' }, { screenId: 'S26', action: 'U', scope: 'ALL' }] } },
      'PUT /roles/3/permissions': { status: 200, body: { roleId: 3, items: [] } },
      'PUT /roles/1/permissions': { status: 409, body: { code: 'SELF_LOCKOUT', message: '시스템 관리자 역할에서 권한 관리(S26) 조회·저장 권한은 뺄 수 없습니다.' } },
    })
    const u = userEvent.setup()
    renderAt('/admin/permissions?role_id=3')
    const table = await screen.findByRole('table', { name: '강사 권한' })
    expect(within(table).getByLabelText('S05 조회')).toBeChecked()
    expect(within(table).getByLabelText('S05 범위')).toHaveDisplayValue('본인 담당')
    expect(within(table).getByLabelText('S20 조회')).toBeDisabled() // S19 권한을 따른다
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()

    await u.click(within(table).getByLabelText('S05 조회')) // 회수
    await u.click(within(table).getByLabelText('S03 조회')) // 부여 → 강사 기본 범위(본인 담당)
    expect(screen.getByText('저장하지 않은 변경: 화면 2개')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText(/강사 권한을 저장했습니다\(화면 2개 변경\)/)).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/roles/3/permissions')?.body).toEqual({
      items: [
        { screenId: 'S01', action: 'R', scope: 'OWN_ASSIGNED' },
        { screenId: 'S03', action: 'R', scope: 'OWN_ASSIGNED' },
      ],
    })

    await u.selectOptions(screen.getByLabelText('역할'), '시스템 관리자')
    const sysTable = await screen.findByRole('table', { name: '시스템 관리자 권한' })
    await u.click(within(sysTable).getByLabelText('S26 수정'))
    await u.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('권한 관리(S26) 조회·저장 권한은 뺄 수 없습니다')
  })
})

describe('S27 감사로그', () => {
  it('기간을 비우면 최근 30일로 조회, 사용자 이름 표시, 행 상세는 바뀐 필드를 강조', async () => {
    const log: AuditLogEntry = {
      logId: 900,
      actorType: 'USER',
      actorUserId: 7,
      actorName: '김운영',
      actorLoginId: 'ops1',
      action: 'UPDATE',
      targetTable: 'course',
      targetId: 3,
      actionAt: '2026-09-28T01:00:00.000Z',
      reason: '기간 조정',
      ipAddress: '10.0.0.5',
    }
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['EXECUTIVE'] }, grants({ S01: 'R', S27: 'R' })) },
      'GET /audit-logs': page([log, { ...log, logId: 901, actorType: 'SYSTEM_BATCH', actorUserId: null, actorName: null, actorLoginId: null, reason: null }]),
      'GET /audit-logs/900': { status: 200, body: { ...log, beforeValue: { course_name: '웹개발', end_date: '2026-12-01' }, afterValue: { course_name: '웹개발', end_date: '2026-12-31' } } },
    })
    const u = userEvent.setup()
    renderAt('/admin/audit-logs')
    const row = await screen.findByRole('row', { name: /기간 조정/ })
    expect(row).toHaveTextContent('김운영(ops1)')
    expect(screen.getByRole('row', { name: /시스템\(배치\)/ })).toBeInTheDocument()
    const q = calls.find((c) => c.path === '/audit-logs')!.query
    expect(q.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((Date.parse(q.get('to')!) - Date.parse(q.get('from')!)) / 86_400_000).toBe(30)
    expect(screen.queryByLabelText('사용자')).not.toBeInTheDocument() // 사용자 목록(S25) 권한이 없으면 필터 없음

    await u.click(within(row).getByRole('button', { name: '기록 900 상세' }))
    const dialog = await screen.findByRole('dialog', { name: '감사로그 #900' })
    const changed = await within(dialog).findByRole('row', { name: /end_date/ })
    expect(changed).toHaveClass('changed')
    expect(within(dialog).getByRole('row', { name: /course_name/ })).not.toHaveClass('changed')
  })
})

describe('S28 탐지규칙', () => {
  it('바꾼 기준값만·사유 필수로 저장, 범위 검사, MANUAL 은 수정 불가', async () => {
    const rules: DetectionRule[] = [
      { ruleId: 1, ruleCode: 'RULE_03', ruleName: '회차 운영기록 지연', isActive: true, initialStatus: 'NEEDS_CHECK', params: { delay_hours: 3 }, description: '운영일지 지연', editable: true },
      { ruleId: 2, ruleCode: 'RULE_05', ruleName: '반복적인 출결 수정', isActive: true, initialStatus: 'NEEDS_CHECK', params: { window_days: 30, min_changes: 3 }, description: '반복 수정', editable: true },
      { ruleId: 7, ruleCode: 'MANUAL', ruleName: '수동 확인 필요 전환', isActive: true, initialStatus: 'NEEDS_CHECK', params: {}, description: '수동', editable: false },
    ]
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: sysMe() },
      'GET /detection-rules': { status: 200, body: { items: rules } },
      'PATCH /detection-rules/2': { status: 200, body: rules[1] },
    })
    const u = userEvent.setup()
    renderAt('/admin/detection-rules')
    expect(await screen.findByRole('row', { name: /MANUAL/ })).toHaveTextContent('수정 불가')
    expect(screen.getByRole('row', { name: /RULE_05/ })).toHaveTextContent('집계 기간(일): 30')

    await u.click(screen.getByRole('button', { name: 'RULE_05 수정' }))
    const dialog = screen.getByRole('dialog', { name: 'RULE_05 수정' })
    await u.clear(within(dialog).getByLabelText('최소 수정 횟수(회)'))
    await u.type(within(dialog).getByLabelText('최소 수정 횟수(회)'), '0')
    await u.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('1~100000 사이의 정수')
    await u.clear(within(dialog).getByLabelText('최소 수정 횟수(회)'))
    await u.type(within(dialog).getByLabelText('최소 수정 횟수(회)'), '5')
    await u.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('변경 사유를 입력해 주세요.')
    await u.type(within(dialog).getByLabelText('변경 사유(필수)'), '오탐 감소')
    await u.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('RULE_05 설정을 저장했습니다. 다음 탐지 실행부터 적용됩니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ params: { min_changes: 5 }, reason: '오탐 감소' })
  })
})
