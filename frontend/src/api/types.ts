// 백엔드 응답 타입(camelCase, backend/src/common/api.ts toApi 규칙). 필요한 필드만 선언한다.

export type RoleCode = 'SYS_ADMIN' | 'OPS_MANAGER' | 'INSTRUCTOR' | 'EXECUTIVE'
export type PermissionAction = 'C' | 'R' | 'U' | 'D' | 'A'

export interface AuthUser {
  userId: number
  loginId: string
  name: string
  roles: RoleCode[]
  linkedInstructorId: number | null
  mustChangePassword: boolean
}

export interface PermissionGrant {
  screenId: string
  action: PermissionAction
  scope: 'ALL' | 'OWN_ASSIGNED'
}

export interface MeResponse {
  user: AuthUser
  permissions: PermissionGrant[]
}

export interface Paged<T> {
  items: T[]
  page: number
  size: number
  total: number
}

export interface CourseSummary {
  courseId: number
  courseName: string
  status: string
}

// GET /dashboard (S01)
export interface DashboardSchedule {
  scheduleId: number
  courseId: number
  courseName: string
  roundNo: number
  startTime: string
  endTime: string
  instructorId: number | null
  instructorName: string | null
  status: string
}

export interface DashboardCounts {
  notCheckedIn: number
  checkoutMissing: number
  operationLogMissing: number
  submissionMissing: number
  reviewPending: number
}

export interface CaseTrainee {
  traineeId: number
  name: string
}

export interface DashboardRecentCase {
  caseId: number
  courseId: number
  courseName: string
  ruleCode: string
  status: string
  assigneeId: number | null
  assigneeName: string | null
  detectedAt: string
  priority: boolean
  trainees: CaseTrainee[]
}

export interface DashboardSummary {
  date: string
  todaySchedules: DashboardSchedule[]
  counts: DashboardCounts
  verificationSummary: {
    byStatus: { status: string; count: number }[]
    recent: DashboardRecentCase[]
  }
}
