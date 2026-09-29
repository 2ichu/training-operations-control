import type { ClosureItem } from '../../api/types'

// 과정 화면에서 함께 쓰는 값·판정(컴포넌트 파일과 분리 — fast refresh 규칙)
export interface CourseFormValues {
  courseName: string
  startDate: string
  endDate: string
  totalHours: string
  trainingSite: string
  managerUserId: string
  /** 결과물 제출기한(D-04, 과정 공통). '' = 기한 없음 */
  submissionDueDate: string
}

export const EMPTY_COURSE: CourseFormValues = { courseName: '', startDate: '', endDate: '', totalHours: '', trainingSite: '', managerUserId: '', submissionDueDate: '' }

export const blockingOf = (items: ClosureItem[]) => items.filter((i) => i.classification === 'BLOCKING' && i.count > 0)
export const warningsOf = (items: ClosureItem[]) => items.filter((i) => i.classification === 'WARNING' && i.count > 0)
