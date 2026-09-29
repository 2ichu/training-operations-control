import { type FormEvent, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { InstructorListItem, RoleCode, UserAccount } from '../../api/types'
import { Modal } from '../../components/Modal'
import { ROLE_LABELS, USER_STATUS_LABELS } from '../../labels'

const ROLES: RoleCode[] = ['OPS_MANAGER', 'INSTRUCTOR', 'EXECUTIVE', 'SYS_ADMIN']

function FormError({ error }: { error: string | null }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null
}

// S25 사용자 등록/수정. 역할은 1인 1역할(D-18). 강사 역할이면 연결할 강사가 필수다(STEP 2.4 — 본인 담당 판정의 전제).
// 등록하면 서버가 임시 비밀번호를 만들어 한 번만 돌려주고, 첫 로그인 때 변경을 강제한다.
export function UserFormDialog({
  user,
  instructors,
  onClose,
  onSaved,
}: {
  /** 있으면 수정 모드 */
  user?: UserAccount
  instructors: InstructorListItem[]
  onClose: () => void
  onSaved: (result: { message: string; tempPassword?: string; loginId?: string }) => void
}) {
  const [loginId, setLoginId] = useState(user?.loginId ?? '')
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState<string>(user?.roleCode ?? '')
  const [instructorId, setInstructorId] = useState(user?.linkedInstructorId ? String(user.linkedInstructorId) : '')
  const [status, setStatus] = useState<string>(user?.status ?? 'ACTIVE')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!user && !loginId.trim()) return setError('로그인ID를 입력해 주세요.')
    if (!name.trim()) return setError('이름을 입력해 주세요.')
    if (!role) return setError('역할을 선택해 주세요.')
    if (role === 'INSTRUCTOR' && !instructorId) return setError('강사 역할은 연결할 강사를 선택해야 합니다.')
    const linked = role === 'INSTRUCTOR' ? Number(instructorId) : null
    setBusy(true)
    setError(null)
    try {
      if (user) {
        const body: Record<string, unknown> = {}
        if (name.trim() !== user.name) body.name = name.trim()
        if ((email.trim() || null) !== user.email) body.email = email.trim() || null
        if (role !== user.roleCode) body.role = role
        if (linked !== user.linkedInstructorId) body.linked_instructor_id = linked
        if (status !== user.status) body.status = status
        if (Object.keys(body).length === 0) {
          setBusy(false)
          return setError('변경한 내용이 없습니다.')
        }
        await api.patch(`/users/${user.userId}`, body)
        onSaved({ message: `${name.trim()} 계정을 수정했습니다.` })
      } else {
        const created = await api.post<UserAccount & { tempPassword: string }>('/users', {
          login_id: loginId.trim(),
          name: name.trim(),
          ...(email.trim() ? { email: email.trim() } : {}),
          role,
          ...(linked ? { linked_instructor_id: linked } : {}),
        })
        onSaved({ message: `${created.name} 계정을 만들었습니다.`, tempPassword: created.tempPassword, loginId: created.loginId })
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장하지 못했습니다.')
      setBusy(false)
    }
  }

  return (
    <Modal title={user ? '사용자 수정' : '사용자 등록'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-row">
          <label className="stacked">
            로그인ID
            <input value={loginId} onChange={(e) => setLoginId(e.target.value)} maxLength={50} disabled={!!user} />
          </label>
          <label className="stacked">
            이름
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
          </label>
        </div>
        <label className="stacked">
          이메일
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={100} />
        </label>
        <div className="form-row">
          <label className="stacked">
            역할
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">선택</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          {role === 'INSTRUCTOR' && (
            <label className="stacked">
              연결 강사
              <select value={instructorId} onChange={(e) => setInstructorId(e.target.value)}>
                <option value="">선택</option>
                {instructors.map((i) => (
                  <option key={i.instructorId} value={i.instructorId}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {user && (
            <label className="stacked">
              상태
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {Object.entries(USER_STATUS_LABELS).map(([code, text]) => (
                  <option key={code} value={code}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {role === 'INSTRUCTOR' && <p className="hint">강사 계정은 연결된 강사가 배정된 과정·회차만 볼 수 있습니다.</p>}
        {user && status === 'INACTIVE' && user.status === 'ACTIVE' && <p className="hint">비활성화하면 이 계정으로 로그인할 수 없습니다. 기록은 그대로 남습니다.</p>}
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '저장 중…' : '저장'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 비밀번호 초기화: 새 임시 비밀번호를 만들고 다음 로그인 때 변경을 강제한다. 값은 이 화면에서 한 번만 보인다.
export function ResetPasswordDialog({ user, onClose, onDone }: { user: UserAccount; onClose: () => void; onDone: (tempPassword: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await api.post<{ tempPassword: string }>(`/users/${user.userId}/reset-password`)
      onDone(result.tempPassword)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '초기화하지 못했습니다.')
      setBusy(false)
    }
  }
  return (
    <Modal title="비밀번호 초기화" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p>
          {user.name}({user.loginId})의 비밀번호를 새 임시 비밀번호로 바꿉니다. 지금 쓰는 비밀번호로는 더 이상 로그인할 수 없습니다.
        </p>
        <FormError error={error} />
        <div className="form-actions">
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? '처리 중…' : '초기화'}
          </button>
          <button type="button" onClick={onClose}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  )
}

// 임시 비밀번호 1회 표시. 닫으면 다시 볼 수 없다(서버·로그 어디에도 원문이 남지 않음).
export function TempPasswordDialog({ loginId, tempPassword, onClose }: { loginId: string; tempPassword: string; onClose: () => void }) {
  return (
    <Modal title="임시 비밀번호" onClose={onClose}>
      <p>
        <strong>{loginId}</strong>의 임시 비밀번호입니다. 이 창을 닫으면 다시 볼 수 없으니 본인에게 안전하게 전달해 주세요. 첫 로그인 때 비밀번호를 바꿔야 합니다.
      </p>
      <p className="temp-password" aria-label="임시 비밀번호 값">
        <code>{tempPassword}</code>
      </p>
      <div className="form-actions">
        <button type="button" className="button-primary" onClick={onClose}>
          확인
        </button>
      </div>
    </Modal>
  )
}
