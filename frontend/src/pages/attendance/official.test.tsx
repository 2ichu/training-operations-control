import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../../App'
import type { OfficialImportBatch, OfficialImportResult } from '../../api/types'
import { INSTRUCTOR_PERMISSIONS, me, mockApi } from '../../test/mock-api'

const renderAt = (path: string) => {
  window.history.replaceState(null, '', path)
  return render(<App />)
}
const courses = { status: 200, body: { items: [{ courseId: 3, courseName: '웹개발 1기', status: 'IN_PROGRESS' }], page: 1, size: 100, total: 1 } }

const batch = (overrides: Partial<OfficialImportBatch> = {}): OfficialImportBatch => ({
  batchId: '11111111-1111-1111-1111-111111111111',
  fileName: '9월공식.csv',
  receivedAt: '2026-09-29T01:00:00.000Z',
  courseId: 3,
  courseName: '웹개발 1기',
  uploadedByName: '김운영',
  total: 5,
  created: 2,
  updated: 0,
  converted: 1,
  unchanged: 0,
  mismatched: 1,
  errors: 1,
  ...overrides,
})

describe('S29 공식 출결 대사', () => {
  it('과정·파일을 골라 올리면 결과 요약과 오류·불일치 행을 보여 주고 이력을 다시 불러온다', async () => {
    let uploaded = false
    const result: OfficialImportResult = {
      batchId: '22222222-2222-2222-2222-222222222222',
      fileName: '공식.csv',
      total: 3,
      counts: { CREATED: 1, CASE: 1, ERROR: 1 },
      rows: [
        { rowNo: 2, roundNo: '1', traineeName: '가', result: 'CREATED', message: '공식 출결로 새로 기록했습니다', attendanceId: 5, caseId: null },
        { rowNo: 3, roundNo: '1', traineeName: '나', result: 'CASE', message: '내부 기록과 15분 기준으로 불일치해 확인 필요 건을 만들었습니다(내부 기록은 그대로)', attendanceId: 6, caseId: 91 },
        { rowNo: 4, roundNo: '9', traineeName: '다', result: 'ERROR', message: '9회차가 없습니다', attendanceId: null, caseId: null },
      ],
    }
    const { calls } = mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /official-attendance-imports': () => ({ status: 200, body: { items: uploaded ? [batch({ fileName: '공식.csv' })] : [], page: 1, size: 20, total: uploaded ? 1 : 0 } }),
      'POST /courses/3/official-attendance': () => {
        uploaded = true
        return { status: 201, body: result }
      },
    })
    const user = userEvent.setup()
    renderAt('/attendance/official')
    expect(await screen.findByText('업로드 이력이 없습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '업로드·반영' }))
    expect(screen.getByRole('alert')).toHaveTextContent('과정을 선택해 주세요.')
    await user.selectOptions(await screen.findByLabelText('과정(필수)'), '3')
    await user.click(screen.getByRole('button', { name: '업로드·반영' }))
    expect(screen.getByRole('alert')).toHaveTextContent('CSV 파일을 선택해 주세요.')

    await user.upload(screen.getByLabelText(/^CSV 파일/), new File(['round_no,trainee_name,birth_date,status\n'], '공식.csv', { type: 'text/csv' }))
    await user.click(screen.getByRole('button', { name: '업로드·반영' }))
    const panel = (await screen.findByText('공식.csv 반영 결과')).closest('.panel') as HTMLElement
    expect(within(panel).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['새로 기록: 1행', '불일치(확인 필요): 1행', '오류(미반영): 1행'])
    expect(within(panel).getByRole('row', { name: /9회차 다.*9회차가 없습니다/ })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: '확인 필요 #91' })).toHaveAttribute('href', '/verification-cases/91')
    const form = calls.find((c) => c.path === '/courses/3/official-attendance')!.body as FormData
    expect((form.get('file') as File).name).toBe('공식.csv')
    await waitFor(() => expect(screen.getByRole('button', { name: '공식.csv 상세' })).toBeInTheDocument()) // 이력 갱신
  })

  it('이력에서 상세를 열면 그 업로드의 행별 결과를 보여 준다', async () => {
    mockApi({
      'GET /auth/me': { status: 200, body: me() },
      'GET /courses': courses,
      'GET /official-attendance-imports': { status: 200, body: { items: [batch()], page: 1, size: 20, total: 1 } },
      'GET /official-attendance-imports/11111111-1111-1111-1111-111111111111': {
        status: 200,
        body: { items: [{ rowNo: 2, roundNo: '1', traineeName: '라', result: 'CONVERTED', message: '내부 기록과 일치해 공식 기록으로 전환했습니다', attendanceId: 5, caseId: null }] },
      },
    })
    const user = userEvent.setup()
    renderAt('/attendance/official')
    expect(await screen.findByRole('row', { name: /9월공식\.csv/ })).toHaveTextContent('김운영')
    await user.click(screen.getByRole('button', { name: '9월공식.csv 상세' }))
    const dialog = await screen.findByRole('dialog', { name: '9월공식.csv 처리 내역' })
    expect(await within(dialog).findByText('공식으로 전환')).toBeInTheDocument()
  })

  it('강사는 메뉴도 접근도 없다', async () => {
    mockApi({ 'GET /auth/me': { status: 200, body: me({ roles: ['INSTRUCTOR'], linkedInstructorId: 2 }, INSTRUCTOR_PERMISSIONS) }, 'GET /courses': courses })
    renderAt('/attendance/official')
    await screen.findByRole('navigation')
    expect(screen.queryByRole('link', { name: '공식 출결 대사' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '공식 출결 대사' })).not.toBeInTheDocument()
  })
})
