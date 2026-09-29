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
  /** 결과물 제출기한(D-04, 과정 공통) */
  submissionDueDate: string | null
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

// ── 훈련생(S02~S06) ─────────────────────────────────────────────────────
// 연락처·생년월일은 서버가 항상 마스킹해서 준다(원문 열람 미도입, decisions.md P1-08)
export interface EnrollmentListItem {
  enrollmentId: number
  traineeId: number
  name: string
  birthDate: string | null
  courseId: number
  courseName: string
  status: string
  appliedAt: string
  confirmedAt: string | null
  cancelReason: string | null
}

export interface TraineeListItem {
  enrollmentId: number
  traineeId: number
  name: string
  birthDate: string | null
  contact: string | null
  courseId: number
  courseName: string
  status: string
  confirmedAt: string | null
}

export interface TraineeEnrollment {
  enrollmentId: number
  courseId: number
  courseName: string
  status: string
  appliedAt: string
  confirmedAt: string | null
  cancelReason: string | null
}

export interface TraineeDetail {
  traineeId: number
  name: string
  birthDate: string | null
  contact: string | null
  registeredAt: string
  enrollments: TraineeEnrollment[]
}

export interface TraineeSearchResult {
  traineeId: number
  name: string
  birthDate: string | null
  contact: string | null
  enrollmentCount: number
}

export interface AttendanceSummaryItem {
  scheduleId: number
  roundNo: number
  classDate: string
  scheduleStatus: string
  attendanceId: number | null
  checkInTime: string | null
  checkOutTime: string | null
  /** 저장 상태 또는 계산값 NOT_CHECKED, 휴강 회차는 null */
  displayStatus: string | null
}

export interface TraineeSubmission {
  submissionId: number
  courseId: number
  courseName: string
  title: string
  version: number
  submittedAt: string
  submitStatus: string
  reviewStatus: string
}

export interface TraineeCase {
  caseId: number
  courseId: number
  courseName: string
  ruleCode: string
  ruleName: string
  status: string
  detectedAt: string
  closedAt: string | null
  priority: boolean
}

export interface CompletionCandidates {
  ready: boolean
  threshold: number
  lateWeight: number
  items: { traineeId: number; enrollmentId: number; name: string; attendanceRate: number }[]
}

export interface TraineeChangeLog {
  logId: number
  entityType: 'TRAINEE' | 'ENROLLMENT'
  entityId: number
  changedBy: number
  changedByName: string
  changedAt: string
  beforeValue: Record<string, unknown> | null
  afterValue: Record<string, unknown> | null
  reason: string
  traineeId: number
  traineeName: string
  courseName: string | null
}

// ── 출결(S07~S10) ──────────────────────────────────────────────────────
// GET /schedules (S13 목록 — S07 회차 선택에 사용)
export interface ScheduleListItem {
  scheduleId: number
  courseId: number
  courseName: string
  roundNo: number
  classDate: string
  startTime: string
  endTime: string
  instructorId: number
  instructorName: string
  content: string | null
  status: string
  displayStatus: string
}

// GET /schedules/{id}/attendance-roster (S07)
export interface RosterItem {
  traineeId: number
  name: string
  attendanceId: number | null
  checkInTime: string | null
  checkOutTime: string | null
  attendanceStatus: string | null
  sourceType: string | null
  /** 저장 상태, 계산값 NOT_CHECKED, 휴강 회차면 null */
  displayStatus: string | null
}

export interface AttendanceBatchResult {
  created?: { attendanceId: number }[]
  updated?: { attendanceId: number }[]
  alreadyExists: unknown[]
  notEligible?: number[]
  notFound?: number[]
}

// GET /courses/{id}/attendance-matrix (S08)
export interface AttendanceMatrix {
  schedules: { scheduleId: number; roundNo: number; classDate: string; status: string }[]
  items: {
    traineeId: number
    name: string
    attendanceRate: number | null
    cells: { scheduleId: number; attendanceId: number | null; displayStatus: string | null }[]
  }[]
}

// GET /attendance/{id} (S09)
export interface AttendanceRecord {
  attendanceId: number
  traineeId: number
  scheduleId: number
  checkInTime: string | null
  checkOutTime: string | null
  attendanceStatus: string
  sourceType: string
  lastModifiedAt: string | null
}

// GET /attendance-change-logs (S10)
export interface AttendanceChangeLog {
  logId: number
  attendanceId: number
  traineeId: number
  traineeName: string
  actorType: 'USER' | 'SYSTEM_BATCH' | 'SYSTEM_API'
  changedBy: number | null
  changedByName: string | null
  changedAt: string
  beforeValue: Record<string, unknown> | null
  afterValue: Record<string, unknown> | null
  reason: string
  scheduleId: number
  roundNo: number
  classDate: string
  courseId: number
  courseName: string
}

// ── 강사·일정(S11~S14) ──────────────────────────────────────────────────
// GET /instructors (S11)
export interface InstructorListItem {
  instructorId: number
  name: string
  /** 마스킹된 값(뒤 4자리만) */
  contact: string | null
  status: 'ACTIVE' | 'INACTIVE'
  assignedCourseCount: number
  createdAt: string
  updatedAt: string | null
}

// GET /instructors/{id} (S12)
export interface InstructorDetail extends Omit<InstructorListItem, 'assignedCourseCount'> {
  linkedAccount: { userId: number; loginId: string; name: string; status: string } | null
}

// PATCH /instructors/{id} — 비활동 전환 시에만 warnings
export interface InstructorUpdateResult extends Omit<InstructorListItem, 'assignedCourseCount'> {
  warnings?: { inProgressAssignmentCount: number }
}

// POST /courses/{id}/schedules, PATCH /schedules/{id}, POST /schedules/{id}/reassign-instructor — 같은 강사·같은 시간대 회차가 있으면 경고
export interface OverlappingSchedule {
  scheduleId: number
  courseId: number
  courseName: string
  roundNo: number
  classDate: string
  startTime: string
  endTime: string
}
export interface ScheduleWriteResult {
  scheduleId: number
  warnings?: { overlappingSchedules: OverlappingSchedule[] }
}

// POST /instructor-assignments/{id}/cancel — 남은 예정 회차가 있으면 경고(P1-16)
export interface AssignmentCancelResult {
  assignmentId: number
  warnings?: { remainingScheduledCount: number }
}

// GET /instructor-change-logs (S14)
export interface InstructorChangeLog {
  logId: number
  entityType: 'INSTRUCTOR' | 'ASSIGNMENT'
  entityId: number
  changedBy: number
  changedByName: string
  changedAt: string
  beforeValue: Record<string, unknown> | null
  afterValue: Record<string, unknown> | null
  reason: string
  instructorId: number | null
  instructorName: string | null
  /** 배정 이력만 */
  courseId: number | null
  courseName: string | null
  roundNo: number | null
}

// ── 운영일지·특이사항(S17·S18) ──────────────────────────────────────────
// GET /courses/{id}/operation-logs (S17): 회차별 작성 현황. 미작성은 계산값(행 없음), 휴강 회차는 displayStatus=null
export interface OperationLogRow {
  scheduleId: number
  roundNo: number
  classDate: string
  startTime: string
  endTime: string
  scheduleStatus: string
  instructorId: number
  instructorName: string
  operationLogId: number | null
  participantCount: number | null
  writtenAt: string | null
  displayStatus: 'WRITTEN' | 'NOT_WRITTEN' | null
}

export interface AttachmentInfo {
  attachmentId: number
  fileName: string
  /** BIGINT 라 문자열로 온다 */
  fileSize: string | number
  uploadedAt: string
}

// GET /schedules/{id}/operation-log (S17)
export interface OperationLogDetail {
  operationLogId: number
  scheduleId: number
  instructorId: number
  instructorName: string
  content: string
  participantCount: number
  issueNote: string | null
  authorId: number
  authorName: string
  writtenAt: string
  attachments: AttachmentInfo[]
}

// GET /course-issues (S18)
export interface CourseIssue {
  issueId: number
  courseId: number
  courseName: string
  scheduleId: number | null
  roundNo: number | null
  classDate: string | null
  category: string
  content: string
  status: 'REGISTERED' | 'IN_REVIEW' | 'RESOLVED'
  reportedBy: number
  reportedByName: string
  reportedAt: string
  verificationCaseId: number | null
  verificationCaseStatus: string | null
}

// ── 결과물(S19~S21) ────────────────────────────────────────────────────
// GET /courses/{id}/submission-status (S19·S20): 확정 훈련생 × submission LEFT JOIN. 미제출은 계산값(NOT_SUBMITTED, 결과물 필드 null)
export interface SubmissionStatusRow {
  traineeId: number
  traineeName: string
  /** 마스킹된 값 */
  contact: string | null
  submissionId: number | null
  title: string | null
  version: number | null
  submittedAt: string | null
  submitStatus: string | null
  reviewStatus: string | null
  /** 등록일시·등록자(audit_log CREATE 기록) */
  registeredAt: string | null
  registeredByName: string | null
  /** 미제출=오늘-기한, 기한후제출=제출일-기한(일). 기한 전·기한 없음은 null */
  overdueDays: number | null
  displayStatus: string
}

export interface SubmissionStatusResponse {
  submissionDueDate: string | null
  items: SubmissionStatusRow[]
}

// GET /submissions/{id} (S21)
export interface SubmissionDetail {
  submissionId: number
  traineeId: number
  traineeName: string
  courseId: number
  courseName: string
  title: string
  version: number
  submittedAt: string
  submitStatus: string
  reviewStatus: string
  attachments: (AttachmentInfo & { entityVersion: number })[]
  reviews: { logId: number; version: number; reviewerId: number; reviewerName: string; reviewedAt: string; reviewResult: string; reviewComment: string | null }[]
}

// ── 시스템 관리(S25~S28) ───────────────────────────────────────────────
// GET /users (S25) — password_hash 는 응답에 없다
export interface UserAccount {
  userId: number
  loginId: string
  name: string
  email: string | null
  linkedInstructorId: number | null
  status: 'ACTIVE' | 'INACTIVE'
  mustChangePassword: boolean
  roleCode: RoleCode | null
  createdAt: string
  updatedAt: string | null
}

// GET /roles (S26)
export interface RoleInfo {
  roleId: number
  roleCode: RoleCode
  roleName: string
}

export interface RoleGrant {
  screenId: string
  action: PermissionAction
  scope: 'ALL' | 'OWN_ASSIGNED'
}

// GET /audit-logs (S27)
export interface AuditLogEntry {
  logId: number
  actorType: 'USER' | 'SYSTEM_RULE' | 'SYSTEM_BATCH' | 'SYSTEM_API'
  actorUserId: number | null
  actorName: string | null
  actorLoginId: string | null
  action: string
  targetTable: string
  targetId: number | null
  actionAt: string
  reason: string | null
  ipAddress: string | null
}

export interface AuditLogDetail extends AuditLogEntry {
  beforeValue: unknown
  afterValue: unknown
}

// GET /detection-rules (S28)
// D-08 지각·조퇴 판정 유예분(S28)
export interface AttendanceSetting {
  lateGraceMinutes: number
  earlyLeaveGraceMinutes: number
}

export interface DetectionRule {
  ruleId: number
  ruleCode: string
  ruleName: string
  isActive: boolean
  initialStatus: string
  params: Record<string, number>
  description: string | null
  editable: boolean
}
