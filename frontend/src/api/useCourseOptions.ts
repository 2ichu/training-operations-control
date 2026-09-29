import { api } from './client'
import type { CourseSummary } from './types'
import { useApi } from './useApi'

// 과정 선택 목록(필터·등록 폼용). 서버가 역할별 범위(강사는 본인 배정 과정)로 걸러 준다.
// statuses 를 주면 해당 상태의 과정만(예: 등록 가능한 과정 = 종료·중단 제외).
export function useCourseOptions(enabled = true, statuses?: string[]) {
  const status = statuses?.join(',')
  return useApi(
    (signal) => (enabled ? api.getAll<CourseSummary>('/courses', { status }, signal).then((r) => r.items) : Promise.resolve([] as CourseSummary[])),
    `${enabled}:${status ?? ''}`,
  )
}
