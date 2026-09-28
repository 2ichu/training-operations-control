import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import type { PermissionAction } from '../api/types'
import { useAuth } from '../auth/auth-context'

export function FullPageStatus({ children }: { children: ReactNode }) {
  return <main className="auth-page">{children}</main>
}

/** 로그인 필수. 초기 비밀번호 상태면 변경 화면 외에는 들어갈 수 없다. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <FullPageStatus>불러오는 중…</FullPageStatus>
  if (state.status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (state.user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />
  return children
}

/** 화면 권한이 없으면 안내만 보여준다(서버도 403 으로 거부한다). */
export function RequirePermission({ screenId, action = 'R', children }: { screenId: string; action?: PermissionAction; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(screenId, action)) {
    return (
      <section className="page">
        <h1>접근 권한 없음</h1>
        <p className="empty-text">이 화면을 볼 권한이 없습니다. 필요한 경우 시스템 관리자에게 문의해 주세요.</p>
      </section>
    )
  }
  return children
}
