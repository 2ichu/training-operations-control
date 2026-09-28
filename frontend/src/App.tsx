import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { AppLayout } from './layout/AppLayout'
import { PLANNED_PATHS } from './menu'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage, NotImplementedPage } from './pages/PlaceholderPages'
import { RequireAuth, RequirePermission } from './routing/guards'
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
          path="/verification-action-logs"
          element={
            <RequirePermission screenId="S24">
              <ActionLogPage />
            </RequirePermission>
          }
        />
        {PLANNED_PATHS.map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={
              <RequirePermission screenId={item.permissionScreen ?? item.screenId}>
                <NotImplementedPage title={item.label} />
              </RequirePermission>
            }
          />
        ))}
        {/* 상세 화면: S23 은 구현, S16 과정 상세·S05 훈련생 상세는 다음 단계에서 구현 */}
        <Route
          path="/courses/:id"
          element={
            <RequirePermission screenId="S16">
              <NotImplementedPage title="과정 상세" />
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
              <NotImplementedPage title="훈련생 상세" />
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
