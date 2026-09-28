import { vi } from 'vitest'
import type { AuthUser, DashboardSummary, MeResponse, PermissionGrant } from '../api/types'

export interface MockCall {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
}

type Handler = (call: MockCall) => { status: number; body?: unknown } | undefined

// fetch 대역: "METHOD /path" → 응답. 정의되지 않은 요청은 404 로 응답하고 calls 에 기록한다.
export function mockApi(routes: Record<string, Handler | { status: number; body?: unknown }>) {
  const calls: MockCall[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const call: MockCall = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname.replace(/^\/api\/v1/, ''),
      query: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    const route = routes[`${call.method} ${call.path}`]
    const result = typeof route === 'function' ? route(call) : route
    const { status, body } = result ?? { status: 404, body: { message: 'not mocked' } }
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
}

export const grants = (spec: Record<string, string>): PermissionGrant[] =>
  Object.entries(spec).flatMap(([screenId, actions]) => [...actions].map((action) => ({ screenId, action: action as PermissionGrant['action'], scope: 'ALL' as const })))

export function me(overrides: Partial<AuthUser> = {}, permissions: PermissionGrant[] = OPS_PERMISSIONS): MeResponse {
  return {
    user: { userId: 7, loginId: 'ops1', name: '김운영', roles: ['OPS_MANAGER'], linkedInstructorId: null, mustChangePassword: false, ...overrides },
    permissions,
  }
}

// backend/seed/permissions.ts 와 같은 형태의 축약본
export const OPS_PERMISSIONS = grants({ S01: 'R', S02: 'RU', S03: 'R', S07: 'CRUA', S15: 'CR', S16: 'CRUA', S19: 'CRU', S22: 'RA', S23: 'RA', S24: 'R' })
export const INSTRUCTOR_PERMISSIONS = grants({ S01: 'R', S03: 'R', S07: 'CRU', S13: 'R', S15: 'R', S16: 'R', S17: 'CRU', S19: 'R' })
export const SYS_PERMISSIONS = grants({ S01: 'R', S15: 'R', S16: 'RA', S22: 'R', S23: 'R', S25: 'CRU', S26: 'RU', S27: 'R', S28: 'RU' })

export function dashboard(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    date: '2026-09-28',
    todaySchedules: [
      { scheduleId: 11, courseId: 3, courseName: '웹개발 1기', roundNo: 5, startTime: '09:00:00', endTime: '18:00:00', instructorId: 2, instructorName: '박강사', status: 'SCHEDULED' },
    ],
    counts: { notCheckedIn: 4, checkoutMissing: 1, operationLogMissing: 2, submissionMissing: 0, reviewPending: 3 },
    verificationSummary: {
      byStatus: [
        { status: 'NEEDS_CHECK', count: 2 },
        { status: 'IN_REVIEW', count: 1 },
      ],
      recent: [
        {
          caseId: 91,
          courseId: 3,
          courseName: '웹개발 1기',
          ruleCode: 'RULE_01',
          status: 'NEEDS_CHECK',
          assigneeId: null,
          assigneeName: null,
          detectedAt: '2026-09-28T01:05:00.000Z',
          priority: false,
          trainees: [
            { traineeId: 1, name: '가' },
            { traineeId: 2, name: '나' },
            { traineeId: 3, name: '다' },
          ],
        },
      ],
    },
    ...overrides,
  }
}
