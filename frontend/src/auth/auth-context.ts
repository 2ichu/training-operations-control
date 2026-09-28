import { createContext, useContext } from 'react'
import type { AuthUser, PermissionAction, PermissionGrant } from '../api/types'

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; notice?: string }
  | { status: 'authenticated'; user: AuthUser; permissions: PermissionGrant[] }

export interface AuthContextValue {
  state: AuthState
  login: (loginId: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** 서버 기준 사용자·권한을 다시 읽는다(비밀번호 변경 후 등) */
  refresh: () => Promise<void>
  can: (screenId: string, action?: PermissionAction) => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth 는 AuthProvider 안에서만 사용할 수 있습니다')
  return value
}

/** 로그인된 화면에서만 쓴다(RequireAuth 아래). */
export function useCurrentUser(): { user: AuthUser; permissions: PermissionGrant[] } {
  const { state } = useAuth()
  if (state.status !== 'authenticated') throw new Error('로그인 상태가 아닙니다')
  return { user: state.user, permissions: state.permissions }
}
