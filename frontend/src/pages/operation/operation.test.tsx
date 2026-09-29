import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { CourseIssue, OperationLogDetail, OperationLogRow } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const page = <T,>(items: T[]) => ({ status: 200, body: { items, page: 1, size: 100, total: items.length } })
const courses = page([{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }])
const insMe = () => me({ userId: 9, loginId: 'ins1', name: '박강사', roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS)

const row = (overrides: Partial<OperationLogRow> = {}): OperationLogRow => ({
  scheduleId: 11,
  roundNo: 1,
  classDate: '2026-09-28',
  startTime: '09:00:00',
  endTime: '18:00:00',
  scheduleStatus: 'SCHEDULED',
  instructorId: 2,
  instructorName: '박강사',
  operationLogId: null,
  participantCount: null,
  writtenAt: null,
  displayStatus: 'NOT_WRITTEN',
  ...overrides,
})
const rows = [
  row(),
  row({ scheduleId: 12, roundNo: 2, operationLogId: 70, participantCount: 18, writtenAt: '2026-09-28T09:30:00.000Z', displayStatus: 'WRITTEN' }),
  row({ scheduleId: 13, roundNo: 3, scheduleStatus: 'CANCELLED', displayStatus: null }),
]
const log = (overrides: Partial<OperationLogDetail> = {}): OperationLogDetail => ({
  operationLogId: 70,
  scheduleId: 12,
  instructorId: 2,
  instructorName: '박강사',
  content: 'React 기초',
  participantCount: 18,
  issueNote: '프로젝터 불량',
  authorId: 9,
  authorName: '박강사',
  writtenAt: '2026-09-28T09:30:00.000Z',
  attachments: [{ attachmentId: 5, fileName: '출석부.pdf', fileSize: '2048', uploadedAt: '2026-09-28T09:31:00.000Z' }],
  ...overrides,
})

describe('S17 회차별 운영일지', () => {
  it('강사: 미작성은 계산 배지, 휴강은 대상 아님, 작성 → 참여인원 필수 검증 → 저장 후 첨부 추가', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: insMe() },
      'GET /courses': courses,
      'GET /courses/3/operation-logs': { status: 200, body: { items: rows } },
      'POST /schedules/11/operation-log': { status: 201, body: { operationLogId: 71 } },
      'GET /schedules/11/operation-log': { status: 200, body: log({ operationLogId: 71, scheduleId: 11, attachments: [] }) },
      'POST /attachments': { status: 201, body: { attachmentId: 6 } },
    })
    const user = userEvent.setup()
    renderAt('/operation-logs?course_id=3')
    const first = await screen.findByRole('row', { name: /^1회차/ })
    expect(within(first).getByText('미작성')).toHaveClass('badge-computed')
    expect(within(screen.getByRole('row', { name: /^3회차/ })).getByText('휴강')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /^3회차/ })).queryByRole('button')).not.toBeInTheDocument()

    await user.click(within(first).getByRole('button', { name: '작성' }))
    const dialog = screen.getByRole('dialog', { name: '1회차 운영일지' })
    await user.type(within(dialog).getByLabelText('교육내용(필수)'), 'HTML 기초')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('참여인원을 0 이상의 정수로 입력해 주세요.')
    await user.type(within(dialog).getByLabelText('참여인원(필수)'), '20')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByText('18명')).toBeInTheDocument() // 저장 후 상세(mock)로 전환 — 첨부 추가가 열린다
    expect(calls.find((c) => c.method === 'POST' && c.path === '/schedules/11/operation-log')?.body).toEqual({ content: 'HTML 기초', participant_count: 20 })

    const file = new File(['hello'], '사진.png', { type: 'image/png' })
    await user.upload(within(dialog).getByLabelText('첨부파일 추가(20MB 이하)'), file)
    await waitFor(() => expect(calls.some((c) => c.path === '/attachments')).toBe(true))
    const upload = calls.find((c) => c.path === '/attachments')!.body as FormData
    expect([upload.get('entity_type'), upload.get('entity_id'), (upload.get('file') as File).name]).toEqual(['OPERATION_LOG', '71', '사진.png'])
  })

  it('작성된 회차: 내용·첨부 다운로드 링크, 운영담당자 검수 수정은 바뀐 필드만, 특이사항으로 등록 → S18 등록 폼에 채워진다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /courses/3/operation-logs': { status: 200, body: { items: rows } },
      'GET /schedules/12/operation-log': { status: 200, body: log() },
      'PATCH /operation-logs/70': { status: 200, body: { operationLogId: 70 } },
      'GET /course-issues': page([]),
      'GET /schedules': page([{ scheduleId: 12, roundNo: 2, classDate: '2026-09-28' }]),
    })
    const user = userEvent.setup()
    renderAt('/operation-logs?course_id=3&schedule_id=12')
    const dialog = await screen.findByRole('dialog', { name: '2회차 운영일지' })
    expect(await within(dialog).findByText('React 기초')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: '출석부.pdf' })).toHaveAttribute('href', '/api/v1/attachments/5/download')
    expect(within(dialog).getByText(/2\.0KB/)).toBeInTheDocument()
    // 운영담당자는 작성(C) 권한이 없어 미작성 회차에 "작성" 버튼이 없다
    expect(within(screen.getByRole('row', { name: /^1회차/ })).queryByRole('button', { name: '작성' })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '수정' }))
    await user.clear(within(dialog).getByLabelText('참여인원(필수)'))
    await user.type(within(dialog).getByLabelText('참여인원(필수)'), '17')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ participant_count: 17 }))

    await user.click(await within(dialog).findByRole('button', { name: '특이사항으로 등록' }))
    const register = await screen.findByRole('dialog', { name: '특이사항 등록' })
    expect(within(register).getByLabelText('내용(필수)')).toHaveValue('프로젝터 불량')
    await waitFor(() => expect(within(register).getByLabelText('관련 회차(선택)')).toHaveDisplayValue('2회차 (2026-09-28)'))
    expect(within(register).getByLabelText('과정')).toHaveDisplayValue('웹개발 1기')
  })

  it('작성여부 필터(종료 체크리스트 "운영일지 미작성"에서 사용)', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: me() }, 'GET /courses': courses, 'GET /courses/3/operation-logs': { status: 200, body: { items: rows } } })
    const user = userEvent.setup()
    renderAt('/operation-logs?course_id=3')
    await screen.findByRole('row', { name: /^2회차/ })
    await user.selectOptions(screen.getByLabelText('작성여부'), '미작성')
    await waitFor(() => expect(screen.queryByRole('row', { name: /^2회차/ })).not.toBeInTheDocument())
    expect(screen.getByRole('row', { name: /^1회차/ })).toBeInTheDocument()
  })
})

const issue = (overrides: Partial<CourseIssue> = {}): CourseIssue => ({
  issueId: 40,
  courseId: 3,
  courseName: '웹개발 1기',
  scheduleId: 12,
  roundNo: 2,
  classDate: '2026-09-28',
  category: 'FACILITY',
  content: '프로젝터 불량으로 30분 지연',
  status: 'REGISTERED',
  reportedBy: 9,
  reportedByName: '박강사',
  reportedAt: '2026-09-28T09:40:00.000Z',
  verificationCaseId: null,
  verificationCaseStatus: null,
  ...overrides,
})

describe('S18 특이사항', () => {
  it('등록: 카테고리·내용 필수, 관련 회차는 선택', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: insMe() },
      'GET /courses': courses,
      'GET /course-issues': page([]),
      'GET /schedules': page([{ scheduleId: 12, roundNo: 2, classDate: '2026-09-28' }]),
      'POST /course-issues': { status: 201, body: issue() },
    })
    const user = userEvent.setup()
    renderAt('/course-issues')
    await user.click(await screen.findByRole('button', { name: '등록' }))
    const dialog = screen.getByRole('dialog', { name: '특이사항 등록' })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: '웹개발 1기' })).toBeInTheDocument())
    await user.selectOptions(within(dialog).getByLabelText('과정'), '웹개발 1기')
    await user.click(within(dialog).getByRole('button', { name: '등록' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('카테고리를 선택해 주세요.')
    await user.selectOptions(within(dialog).getByLabelText('카테고리'), '안전')
    await user.type(within(dialog).getByLabelText('내용(필수)'), '안전모 부족')
    await user.click(within(dialog).getByRole('button', { name: '등록' }))
    expect(await screen.findByText('특이사항을 등록했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ course_id: 3, category: 'SAFETY', content: '안전모 부족' })
    // 강사는 수정·전환·조치완료 권한이 없다
    expect(screen.queryByRole('button', { name: '확인 필요로 전환' })).not.toBeInTheDocument()
  })

  it('운영담당자: 연결 확인 건 상태를 참고로 보여주고, 활성 건이 있으면 재전환 버튼 없음. 전환하면 선택 훈련생과 함께 S23 으로 이동', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /course-issues': page([issue(), issue({ issueId: 41, content: '민원 접수', category: 'COMPLAINT', status: 'IN_REVIEW', verificationCaseId: 91, verificationCaseStatus: 'IN_REVIEW' })]),
      'GET /trainees': page([
        { traineeId: 1, name: '김하나' },
        { traineeId: 2, name: '이두리' },
      ]),
      'POST /course-issues/40/escalate': { status: 201, body: { caseId: 92 } },
      'GET /verification-cases/92': { status: 404, body: { message: 'x' } },
    })
    const user = userEvent.setup()
    renderAt('/course-issues')
    const linked = await screen.findByRole('row', { name: /민원 접수/ })
    expect(within(linked).getByRole('link', { name: '확인중' })).toHaveAttribute('href', '/verification-cases/91')
    expect(within(linked).queryByRole('button', { name: '확인 필요로 전환' })).not.toBeInTheDocument()

    const target = screen.getByRole('row', { name: /프로젝터 불량/ })
    expect(within(target).getByText('시설')).toBeInTheDocument()
    await user.click(within(target).getByRole('button', { name: '확인 필요로 전환' }))
    const dialog = screen.getByRole('dialog', { name: '확인 필요로 전환' })
    await user.click(await within(dialog).findByLabelText('이두리'))
    await user.click(within(dialog).getByRole('button', { name: '전환' }))
    await waitFor(() => expect(window.location.pathname).toBe('/verification-cases/92'))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ trainee_ids: [2] })
    expect(calls.find((c) => c.path === '/trainees')?.query.get('status')).toBe('CONFIRMED')
  })

  it('이미 전환된 건(409)은 새로 만들지 않고 안내, 조치완료는 연결 확인 건과 독립', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /course-issues': page([issue({ verificationCaseId: 90, verificationCaseStatus: 'CONFIRMED' })]),
      'GET /trainees': page([]),
      'POST /course-issues/40/escalate': { status: 409, body: { code: 'VERIFICATION_CASE_EXISTS', message: '이미 확인 필요로 전환된 특이사항입니다.' } },
      'POST /course-issues/40/resolve': { status: 200, body: issue({ status: 'RESOLVED' }) },
    })
    const user = userEvent.setup()
    renderAt('/course-issues')
    const target = await screen.findByRole('row', { name: /프로젝터 불량/ })
    // 연결 건이 종결(확인완료)이면 다시 전환할 수 있다
    await user.click(within(target).getByRole('button', { name: '확인 필요로 전환' }))
    await user.click(within(screen.getByRole('dialog', { name: '확인 필요로 전환' })).getByRole('button', { name: '전환' }))
    expect(await screen.findByText(/이미 확인 필요로 전환된 특이사항입니다\. 목록의 연결 확인 건/)).toBeInTheDocument()

    await user.click(within(screen.getByRole('row', { name: /프로젝터 불량/ })).getByRole('button', { name: '조치완료' }))
    const dialog = screen.getByRole('dialog', { name: '조치완료 처리' })
    expect(within(dialog).getByText(/연결된 확인 건은 함께 종결되지 않습니다/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '조치완료' }))
    expect(await screen.findByText('특이사항을 조치완료 처리했습니다.')).toBeInTheDocument()
    expect(calls.some((c) => c.path === '/course-issues/40/resolve')).toBe(true)
  })
})
