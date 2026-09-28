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
  /** 저장값 + 계산값 "진행완료"(COMPLETED, baseline 3-6) */
  displayStatus: string
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

// GET /verification-cases (S22)
export interface VerificationCaseListItem {
  caseId: number
  courseId: number
  courseName: string
  ruleCode: string
  ruleName: string
  detectedAt: string
  status: string
  assigneeId: number | null
  assigneeName: string | null
  closedAt: string | null
  priority: boolean
  trainees: CaseTrainee[]
}

// GET /verification-cases/{id} (S23)
export interface CaseTraineeLink extends CaseTrainee {
  attendanceId: number | null
}

export interface ActionLogEntry {
  logId: number
  caseId?: number
  courseId?: number
  courseName?: string
  actorId: number
  actorName: string
  actionAt: string
  actionType: string
  previousStatus: string | null
  newStatus: string | null
  note: string | null
}

export interface VerificationCaseDetail {
  caseId: number
  courseId: number
  courseName: string
  ruleCode: string
  ruleName: string
  detectedAt: string
  evidence: { dedupe_key?: string; items: Record<string, unknown>[] }
  status: string
  assigneeId: number | null
  assigneeName: string | null
  confirmationNote: string | null
  actionNote: string | null
  closedAt: string | null
  priority: boolean
  trainees: CaseTraineeLink[]
  schedules: { scheduleId: number; roundNo: number; classDate: string }[]
  relatedCourseIssue: { issueId: number; category: string; content: string; status: string } | null
  relatedOperationLog: { operationLogId: number; scheduleId: number; content: string; writtenAt: string } | null
  actionLogs: ActionLogEntry[]
}

// GET /courses (S15), GET /courses/{id} (S16)
export interface CourseListItem {
  courseId: number
  courseName: string
  startDate: string
  endDate: string
  totalHours: number
  trainingSite: string
  managerUserId: number
  managerName: string | null
  status: string
  createdAt: string
  updatedAt: string
  confirmedTraineeCount: number
}

export interface CourseDetail extends Omit<CourseListItem, 'confirmedTraineeCount'> {
  traineeSummary: { status: string; count: number }[]
  instructorAssignments: { assignmentId: number; instructorId: number; instructorName: string; roundNo: number | null; status: string; assignedAt: string }[]
  schedules: { scheduleId: number; roundNo: number; classDate: string; startTime: string; endTime: string; instructorId: number; status: string; displayStatus: string }[]
}

export interface ManagerCandidate {
  userId: number
  name: string
}

// GET /courses/{id}/closure-checklist (baseline 9절)
export interface ClosureItem {
  item: number
  label: string
  classification: 'BLOCKING' | 'WARNING' | 'NOT_NEEDED'
  count: number
}
