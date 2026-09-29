import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { SubmissionDetail, SubmissionStatusRow } from '../../api/types'
import { grants, INSTRUCTOR_PERMISSIONS, me, mockApi } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const courses = { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }], page: 1, size: 100, total: 1 } }

const missing = (overrides: Partial<SubmissionStatusRow> = {}): SubmissionStatusRow => ({
  traineeId: 1,
  traineeName: '김하나',
  contact: '***-****-1111',
  submissionId: null,
  title: null,
  version: null,
  submittedAt: null,
  submitStatus: null,
  reviewStatus: null,
  registeredAt: null,
  registeredByName: null,
  overdueDays: null,
  displayStatus: 'NOT_SUBMITTED',
  ...overrides,
})
const submitted = (overrides: Partial<SubmissionStatusRow> = {}): SubmissionStatusRow =>
  missing({
    traineeId: 2,
    traineeName: '이두리',
    submissionId: 50,
    title: '1차 과제',
    version: 1,
    submittedAt: '2026-09-27T09:00:00.000Z',
    submitStatus: 'SUBMITTED',
    reviewStatus: 'PENDING',
    registeredAt: '2026-09-28T01:00:00.000Z',
    registeredByName: '김운영',
    displayStatus: 'SUBMITTED',
    ...overrides,
  })

describe('S19 결과물 제출현황', () => {
  it('미제출은 계산 배지, 결과물 등록은 행 저장 후 파일을 그 결과물에 올린다(원본 제출 일시는 KST)', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /courses/3/submission-status': { status: 200, body: { items: [missing(), submitted()] } },
      'POST /courses/3/submissions': { status: 201, body: { submissionId: 51 } },
      'POST /attachments': { status: 201, body: { attachmentId: 9 } },
    })
    const user = userEvent.setup()
    renderAt('/submissions?course_id=3')
    const row = await screen.findByRole('row', { name: /김하나/ })
    expect(within(row).getByText('미제출')).toHaveClass('badge-computed')
    const done = screen.getByRole('row', { name: /이두리/ })
    expect(within(done).getByRole('link', { name: '1차 과제' })).toHaveAttribute('href', '/submissions/50')
    expect(done).toHaveTextContent('2026-09-28 10:00') // 등록일시(KST)
    expect(done).toHaveTextContent('김운영')

    await user.click(within(row).getByRole('button', { name: '김하나 결과물 등록' }))
    const dialog = screen.getByRole('dialog', { name: '결과물 등록' })
    expect(within(dialog).getByLabelText('훈련생')).toHaveDisplayValue('김하나')
    await user.type(within(dialog).getByLabelText('제목'), '1차 과제')
    await user.type(within(dialog).getByLabelText('원본 제출 일시(훈련생이 실제 제출한 시각)'), '2026-09-27T18:30')
    await user.click(within(dialog).getByRole('button', { name: '등록' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('파일을 선택해 주세요.')
    await user.upload(within(dialog).getByLabelText('파일(20MB 이하)'), new File(['x'], '과제.pdf', { type: 'application/pdf' }))
    await user.click(within(dialog).getByRole('button', { name: '등록' }))
    expect(await screen.findByText('결과물을 등록했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/courses/3/submissions')?.body).toEqual({ trainee_id: 1, title: '1차 과제', submitted_at: '2026-09-27T18:30:00+09:00' })
    const form = calls.find((c) => c.path === '/attachments')!.body as FormData
    expect([form.get('entity_type'), form.get('entity_id')]).toEqual(['SUBMISSION', '51'])
  })

  it('재등록은 버전을 올린 뒤 새 파일을 올리고, 파일 업로드만 실패하면 그 사실을 알려 준다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /courses/3/submission-status': { status: 200, body: { items: [submitted({ reviewStatus: 'REVISION_REQUESTED' })] } },
      'POST /submissions/50/re-register': { status: 200, body: { submissionId: 50, version: 2 } },
      'POST /attachments': { status: 400, body: { code: 'FILE_TOO_LARGE', message: '파일은 20MB 이하여야 합니다' } },
    })
    const user = userEvent.setup()
    renderAt('/submissions?course_id=3')
    await user.click(await screen.findByRole('button', { name: '이두리 1차 과제 재등록' }))
    const dialog = screen.getByRole('dialog', { name: '결과물 재등록' })
    await user.type(within(dialog).getByLabelText('원본 제출 일시(재제출 시각)'), '2026-09-29T10:00')
    await user.upload(within(dialog).getByLabelText('새 파일(20MB 이하)'), new File(['x'], 'v2.pdf'))
    await user.click(within(dialog).getByRole('button', { name: '재등록' }))
    expect(await screen.findByText('v2로 재등록했습니다. 다만 파일을 올리지 못했습니다(파일은 20MB 이하여야 합니다). 결과물 상세에서 다시 올려 주세요.')).toBeInTheDocument()
    expect(calls.find((c) => c.path === '/submissions/50/re-register')?.body).toEqual({ submitted_at: '2026-09-29T10:00:00+09:00' })
  })

  it('강사: 조회만(등록·재등록·검토 없음, 검토 화면 링크도 없음)', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) },
      'GET /courses': courses,
      'GET /courses/3/submission-status': { status: 200, body: { items: [missing(), submitted()] } },
    })
    renderAt('/submissions?course_id=3')
    await screen.findByRole('row', { name: /이두리/ })
    expect(screen.queryByRole('button', { name: /등록/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '1차 과제' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /검토/ })).not.toBeInTheDocument()
  })
})

describe('S20 결과물 미제출', () => {
  it('미제출 + 기한후제출(missing_or_late), 제출기한·경과일수, 마스킹 연락처, 조회 전용', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /courses/3/submission-status': {
        status: 200,
        body: { submissionDueDate: '2026-09-20', items: [missing({ overdueDays: 9 }), submitted({ submitStatus: 'LATE_SUBMITTED', displayStatus: 'LATE_SUBMITTED', overdueDays: 2 })] },
      },
    })
    renderAt('/submissions/missing?course_id=3')
    const row = await screen.findByRole('row', { name: /김하나/ })
    expect(row).toHaveTextContent('***-****-1111')
    expect(row).toHaveTextContent('2026-09-20')
    expect(row).toHaveTextContent('9일')
    expect(within(row).getByText('미제출')).toHaveClass('badge-computed')
    const late = screen.getByRole('row', { name: /이두리/ })
    expect(late).toHaveTextContent('기한후제출')
    expect(late).toHaveTextContent('2일')
    await waitFor(() => expect(row).toHaveTextContent('웹개발 1기'))
    expect(calls.find((c) => c.path === '/courses/3/submission-status')?.query.get('missing_or_late')).toBe('true')
    expect(within(screen.getByRole('table')).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '제출현황에서 등록하기' })).toHaveAttribute('href', '/submissions?course_id=3')
  })

  it('제출기한이 없는 과정은 안내하고 경과일수는 비운다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /courses/3/submission-status': { status: 200, body: { submissionDueDate: null, items: [missing()] } },
    })
    renderAt('/submissions/missing?course_id=3')
    expect(await screen.findByText(/이 과정에는 결과물 제출기한이 없습니다/)).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /김하나/ })).toHaveTextContent('-')
  })
})

const detail = (overrides: Partial<SubmissionDetail> = {}): SubmissionDetail => ({
  submissionId: 50,
  traineeId: 2,
  traineeName: '이두리',
  courseId: 3,
  courseName: '웹개발 1기',
  title: '1차 과제',
  version: 2,
  submittedAt: '2026-09-29T01:00:00.000Z',
  submitStatus: 'SUBMITTED',
  reviewStatus: 'PENDING',
  attachments: [
    { attachmentId: 1, entityVersion: 1, fileName: 'v1.pdf', fileSize: '1024', uploadedAt: '2026-09-28T01:00:00.000Z' },
    { attachmentId: 2, entityVersion: 2, fileName: 'v2.pdf', fileSize: '2048', uploadedAt: '2026-09-29T01:00:00.000Z' },
  ],
  reviews: [{ logId: 7, version: 1, reviewerId: 7, reviewerName: '김운영', reviewedAt: '2026-09-28T02:00:00.000Z', reviewResult: 'REVISION_REQUESTED', reviewComment: '표지 보완' }],
  ...overrides,
})

describe('S21 결과물 검토', () => {
  it('버전별 파일·검토이력을 구분해 보여주고, 검토결과를 현재 버전으로 저장한다', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /submissions/50': { status: 200, body: detail() },
      'POST /submissions/50/reviews': { status: 201, body: { submissionId: 50, reviewStatus: 'APPROVED' } },
    })
    const user = userEvent.setup()
    renderAt('/submissions/50')
    expect(await screen.findByRole('heading', { name: '1차 과제 — 이두리' })).toBeInTheDocument()
    const v1 = screen.getByRole('region', { name: 'v1' })
    expect(within(v1).getByRole('link', { name: 'v1.pdf' })).toHaveAttribute('href', '/api/v1/attachments/1/download')
    expect(within(v1).getByText('보완요청')).toBeInTheDocument()
    expect(within(v1).getByText('표지 보완')).toBeInTheDocument()
    const v2 = screen.getByRole('region', { name: 'v2' })
    expect(within(v2).getByText('현재')).toBeInTheDocument()
    expect(within(v2).getByText('검토 기록 없음')).toBeInTheDocument()

    const form = screen.getByRole('form', { name: '검토 입력' })
    await user.click(within(form).getByRole('button', { name: '저장' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('검토결과를 선택해 주세요.')
    await user.click(within(form).getByLabelText('적합'))
    await user.click(within(form).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('v2 검토결과(적합)를 저장했습니다.')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ review_result: 'APPROVED' })
  })

  it('관리자/책임자는 읽기만(검토 입력 없음), 강사는 화면 접근 불가', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: me({ roles: ['EXECUTIVE'] }, grants({ S01: 'R', S19: 'R', S21: 'R' })) }, 'GET /submissions/50': { status: 200, body: detail() } })
    renderAt('/submissions/50')
    await screen.findByRole('heading', { name: '1차 과제 — 이두리' })
    expect(screen.queryByRole('form', { name: '검토 입력' })).not.toBeInTheDocument()
  })

  it('강사는 S21 에 들어올 수 없다', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'] }, INSTRUCTOR_PERMISSIONS) } })
    renderAt('/submissions/50')
    expect(await screen.findByRole('heading', { name: '접근 권한 없음' })).toBeInTheDocument()
  })
})

describe('검토이력(S21 진입 목록)', () => {
  it('기본은 검토 대기, 미제출 행은 빼고 결과물 상세로 연결', async () => {
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /courses/3/submission-status': { status: 200, body: { items: [submitted()] } },
    })
    const user = userEvent.setup()
    renderAt('/submission-reviews?course_id=3')
    const row = await screen.findByRole('row', { name: /이두리/ })
    expect(within(row).getByRole('link', { name: '1차 과제' })).toHaveAttribute('href', '/submissions/50')
    expect(calls.find((c) => c.path === '/courses/3/submission-status')?.query.get('review_status')).toBe('PENDING')
    await user.selectOptions(screen.getByLabelText('검토상태'), '전체')
    await waitFor(() => expect(calls.at(-1)?.query.get('review_status')).toBeNull())
  })
})
