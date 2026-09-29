import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { AppLayout } from './layout/AppLayout'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { AuditLogPage } from './pages/admin/AuditLogPage'
import { DetectionRulePage } from './pages/admin/DetectionRulePage'
import { PermissionPage } from './pages/admin/PermissionPage'
import { UserListPage } from './pages/admin/UserListPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/PlaceholderPages'
import { RequireAuth, RequirePermission } from './routing/guards'
import { AttendanceChangeLogPage } from './pages/attendance/AttendanceChangeLogPage'
import { CourseAttendancePage } from './pages/attendance/CourseAttendancePage'
import { DailyAttendancePage } from './pages/attendance/DailyAttendancePage'
import { CourseCreatePage } from './pages/course/CourseCreatePage'
import { CourseDetailPage } from './pages/course/CourseDetailPage'
import { CourseListPage } from './pages/course/CourseListPage'
import { InstructorChangeLogPage } from './pages/instructor/InstructorChangeLogPage'
import { InstructorCreatePage } from './pages/instructor/InstructorCreatePage'
import { InstructorDetailPage } from './pages/instructor/InstructorDetailPage'
import { InstructorListPage } from './pages/instructor/InstructorListPage'
import { CourseIssuePage } from './pages/operation/CourseIssuePage'
import { OperationLogPage } from './pages/operation/OperationLogPage'
import { SchedulePage } from './pages/schedule/SchedulePage'
import { MissingSubmissionPage } from './pages/submission/MissingSubmissionPage'
import { SubmissionDetailPage } from './pages/submission/SubmissionDetailPage'
import { SubmissionReviewListPage } from './pages/submission/SubmissionReviewListPage'
import { SubmissionStatusPage } from './pages/submission/SubmissionStatusPage'
import { EnrollmentReviewPage } from './pages/trainee/EnrollmentReviewPage'
import { TraineeChangeLogPage } from './pages/trainee/TraineeChangeLogPage'
import { TraineeCreatePage } from './pages/trainee/TraineeCreatePage'
import { TraineeDetailPage } from './pages/trainee/TraineeDetailPage'
import { TraineeEditPage } from './pages/trainee/TraineeEditPage'
import { TraineeListPage } from './pages/trainee/TraineeListPage'
import { ActionLogPage } from './pages/verification/ActionLogPage'
import { VerificationCaseDetailPage } from './pages/verification/VerificationCaseDetailPage'
import { VerificationCaseListPage } from './pages/verification/VerificationCaseListPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route
          index
          element={
            <RequirePermission screenId="S01">
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="/verification-cases"
          element={
            <RequirePermission screenId="S22">
              <VerificationCaseListPage />
            </RequirePermission>
          }
        />
        <Route
          path="/attendance/daily"
          element={
            <RequirePermission screenId="S07">
              <DailyAttendancePage />
            </RequirePermission>
          }
        />
        <Route
          path="/attendance/course"
          element={
            <RequirePermission screenId="S08">
              <CourseAttendancePage />
            </RequirePermission>
          }
        />
        <Route
          path="/attendance-change-logs"
          element={
            <RequirePermission screenId="S10">
              <AttendanceChangeLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="/enrollments"
          element={
            <RequirePermission screenId="S02">
              <EnrollmentReviewPage />
            </RequirePermission>
          }
        />
        <Route
          path="/trainees"
          element={
            <RequirePermission screenId="S03">
              <TraineeListPage />
            </RequirePermission>
          }
        />
        <Route
          path="/trainees/new"
          element={
            <RequirePermission screenId="S04" action="C">
              <TraineeCreatePage />
            </RequirePermission>
          }
        />
        <Route
          path="/trainees/:id/edit"
          element={
            <RequirePermission screenId="S04" action="U">
              <TraineeEditPage />
            </RequirePermission>
          }
        />
        <Route
          path="/trainee-change-logs"
          element={
            <RequirePermission screenId="S06">
              <TraineeChangeLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="/instructors"
          element={
            <RequirePermission screenId="S11">
              <InstructorListPage />
            </RequirePermission>
          }
        />
        <Route
          path="/instructors/new"
          element={
            <RequirePermission screenId="S12" action="C">
              <InstructorCreatePage />
            </RequirePermission>
          }
        />
        <Route
          path="/schedules"
          element={
            <RequirePermission screenId="S13">
              <SchedulePage />
            </RequirePermission>
          }
        />
        <Route
          path="/instructor-change-logs"
          element={
            <RequirePermission screenId="S14">
              <InstructorChangeLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="/operation-logs"
          element={
            <RequirePermission screenId="S17">
              <OperationLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="/course-issues"
          element={
            <RequirePermission screenId="S18">
              <CourseIssuePage />
            </RequirePermission>
          }
        />
        <Route
          path="/submissions"
          element={
            <RequirePermission screenId="S19">
              <SubmissionStatusPage />
            </RequirePermission>
          }
        />
        <Route
          path="/submissions/missing"
          element={
            <RequirePermission screenId="S19">
              <MissingSubmissionPage />
            </RequirePermission>
          }
        />
        <Route
          path="/submission-reviews"
          element={
            <RequirePermission screenId="S21">
              <SubmissionReviewListPage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequirePermission screenId="S25">
              <UserListPage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/permissions"
          element={
            <RequirePermission screenId="S26">
              <PermissionPage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <RequirePermission screenId="S27">
              <AuditLogPage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/detection-rules"
          element={
            <RequirePermission screenId="S28">
              <DetectionRulePage />
            </RequirePermission>
          }
        />
        <Route
          path="/courses"
          element={
            <RequirePermission screenId="S15">
              <CourseListPage />
            </RequirePermission>
          }
        />
        <Route
          path="/courses/new"
          element={
            <RequirePermission screenId="S16" action="C">
              <CourseCreatePage />
            </RequirePermission>
          }
        />
        <Route
          path="/verification-action-logs"
          element={
            <RequirePermission screenId="S24">
              <ActionLogPage />
            </RequirePermission>
          }
        />
        {/* 상세 화면: S16 과정·S23 확인 필요·S05 훈련생·S12 강사·S21 결과물 */}
        <Route
          path="/submissions/:id"
          element={
            <RequirePermission screenId="S21">
              <SubmissionDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="/instructors/:id"
          element={
            <RequirePermission screenId="S12">
              <InstructorDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="/courses/:id"
          element={
            <RequirePermission screenId="S16">
              <CourseDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="/verification-cases/:id"
          element={
            <RequirePermission screenId="S23">
              <VerificationCaseDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="/trainees/:id"
          element={
            <RequirePermission screenId="S05">
              <TraineeDetailPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
