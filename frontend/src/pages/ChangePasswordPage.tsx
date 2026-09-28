import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiError, api } from '../api/client'
import { useAuth, useCurrentUser } from '../auth/auth-context'

// backend auth.service MIN_PASSWORD_LENGTH 와 같은 값(서버가 최종 검증한다)
const MIN_LENGTH = 8

// 본인 비밀번호 변경. 초기·초기화 비밀번호로 로그인하면(mustChangePassword) 변경 전까지 다른 화면으로 갈 수 없다(baseline 10-2 #5).
export function ChangePasswordPage() {
  const { refresh, logout } = useAuth()
  const { user } = useCurrentUser()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const forced = user.mustChangePassword

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!currentPassword || !newPassword) return setError('모든 항목을 입력해 주세요.')
    if (newPassword.length < MIN_LENGTH) return setError(`새 비밀번호는 ${MIN_LENGTH}자 이상이어야 합니다.`)
    if (newPassword !== confirm) return setError('새 비밀번호 확인이 일치하지 않습니다.')
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      await refresh()
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '비밀번호를 변경할 수 없습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const form = (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <h1>비밀번호 변경</h1>
      {forced && <p className="notice">초기 비밀번호로 로그인했습니다. 계속하려면 비밀번호를 변경해 주세요.</p>}
      <label>
        현재 비밀번호
        <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} maxLength={200} />
      </label>
      <label>
        새 비밀번호 <span className="hint">({MIN_LENGTH}자 이상)</span>
        <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} maxLength={200} />
      </label>
      <label>
        새 비밀번호 확인
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={200} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={submitting}>
          {submitting ? '변경 중…' : '변경'}
        </button>
        {forced ? (
          <button type="button" onClick={() => void logout()}>
            로그아웃
          </button>
        ) : (
          <button type="button" onClick={() => navigate(-1)}>
            취소
          </button>
        )}
      </div>
    </form>
  )

  return forced ? <main className="auth-page">{form}</main> : <section className="page narrow">{form}</section>
}
