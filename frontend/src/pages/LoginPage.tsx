import { type FormEvent, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/auth-context'

export function LoginPage() {
  const { state, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (state.status === 'authenticated') return <Navigate to={from} replace />

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!loginId.trim() || !password) {
      setError('아이디와 비밀번호를 입력해 주세요.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await login(loginId.trim(), password)
      navigate(from, { replace: true })
    } catch (e) {
      // 401 은 서버가 아이디·비밀번호 중 무엇이 틀렸는지 구분하지 않는 메시지를, 429 는 잠금 안내를 준다
      setError(e instanceof ApiError ? e.message : '로그인할 수 없습니다.')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  const notice = state.status === 'anonymous' ? state.notice : undefined

  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        <h1>훈련과정 통합관리</h1>
        {notice && !error && <p className="notice">{notice}</p>}
        <label>
          아이디
          <input name="loginId" autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} maxLength={50} autoFocus />
        </label>
        <label>
          비밀번호
          <input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={200} />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? '확인 중…' : '로그인'}
        </button>
      </form>
    </main>
  )
}
