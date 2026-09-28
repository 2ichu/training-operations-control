import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, request, setUnauthorizedListener } from '../api/client'
import type { MeResponse, PermissionAction } from '../api/types'
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context'
import { can } from './permissions'

const SESSION_EXPIRED = '세션이 만료되었습니다. 다시 로그인해 주세요.'

// 세션 상태의 원본은 서버(httpOnly 쿠키 + GET /auth/me)다. 브라우저 저장소에 사용자·권한을 보관하지 않는다.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  const loadMe = useCallback(async (): Promise<AuthState> => {
    try {
      const me = await request<MeResponse>('GET', '/auth/me', { skipUnauthorizedHandler: true })
      return { status: 'authenticated', user: me.user, permissions: me.permissions }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return { status: 'anonymous' }
      throw error
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadMe()
      .then((next) => !cancelled && setState(next))
      .catch(() => !cancelled && setState({ status: 'anonymous', notice: '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' }))
    return () => {
      cancelled = true
    }
  }, [loadMe])

  // 로그인 이후 어떤 API 든 401 을 받으면 세션이 끝난 것이다(유휴·절대 만료, 계정 비활성화 — backend auth.config).
  useEffect(() => {
    setUnauthorizedListener(() => setState({ status: 'anonymous', notice: SESSION_EXPIRED }))
    return () => setUnauthorizedListener(null)
  }, [])

  const login = useCallback(
    async (loginId: string, password: string) => {
      await request('POST', '/auth/login', { body: { loginId, password }, skipUnauthorizedHandler: true })
      setState(await loadMe())
    },
    [loadMe],
  )

  const logout = useCallback(async () => {
    try {
      await request('POST', '/auth/logout', { skipUnauthorizedHandler: true })
    } finally {
      setState({ status: 'anonymous' })
    }
  }, [])

  const refresh = useCallback(async () => setState(await loadMe()), [loadMe])

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login,
      logout,
      refresh,
      can: (screenId: string, action: PermissionAction = 'R') => state.status === 'authenticated' && can(state.permissions, screenId, action),
    }),
    [state, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
