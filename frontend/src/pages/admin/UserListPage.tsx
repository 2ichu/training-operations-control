import { useState } from 'react'
import { api } from '../../api/client'
import type { InstructorListItem, Paged, UserAccount } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText, Loading } from '../../components/Feedback'
import { Pagination } from '../../components/Pagination'
import { formatDateTime } from '../../format'
import { label, ROLE_LABELS, USER_STATUS_LABELS } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'
import { ResetPasswordDialog, TempPasswordDialog, UserFormDialog } from './UserDialogs'

const PAGE_SIZE = 20

type Dialog = { kind: 'create' } | { kind: 'edit' | 'reset'; user: UserAccount } | { kind: 'temp'; loginId: string; tempPassword: string }

// S25 사용자(system-design 7-A): 계정 등록·역할 부여·비활성화·비밀번호 초기화. 시스템 관리자 전용.
// 마지막 활성 시스템 관리자는 비활성화·역할 변경을 서버가 막는다(P5-09 잠금 방지).
export function UserListPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const page = Number(get('page')) || 1
  const query = { name: get('name'), login_id: get('login_id'), role: get('role'), status: get('status'), page, size: PAGE_SIZE }
  const list = useApi((signal) => api.get<Paged<UserAccount>>('/users', query, signal), JSON.stringify(query))
  // 강사 역할 계정의 연결 강사 표시·선택용
  const instructors = useApi(
    (signal) => (can('S11', 'R') ? api.getAll<InstructorListItem>('/instructors', {}, signal).then((r) => r.items) : Promise.resolve([] as InstructorListItem[])),
    'instructors',
  )
  const [name, setName] = useState(get('name'))
  const [loginId, setLoginId] = useState(get('login_id'))
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const items = list.data?.items ?? []
  const instructorName = (id: number | null) => (id === null ? '-' : (instructors.data?.find((i) => i.instructorId === id)?.name ?? `#${id}`))

  return (
    <section className="page">
      <div className="page-header">
        <h1>사용자</h1>
        {can('S25', 'C') && (
          <button type="button" className="button-primary" onClick={() => setDialog({ kind: 'create' })}>
            사용자 등록
          </button>
        )}
      </div>
      <form
        className="filters filter-bar"
        onSubmit={(e) => {
          e.preventDefault()
          set({ name: name.trim() || undefined, login_id: loginId.trim() || undefined })
        }}
      >
        <label>
          이름
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </label>
        <label>
          로그인ID
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} maxLength={50} />
        </label>
        <button type="submit">검색</button>
        <label>
          역할
          <select value={get('role')} onChange={(e) => set({ role: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(ROLE_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          상태
          <select value={get('status')} onChange={(e) => set({ status: e.target.value })}>
            <option value="">전체</option>
            {Object.entries(USER_STATUS_LABELS).map(([code, text]) => (
              <option key={code} value={code}>
                {text}
              </option>
            ))}
          </select>
        </label>
      </form>

      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {list.status === 'error' && <ErrorText error={list.error} onRetry={list.reload} />}
      <div className={list.status === 'loading' && list.data ? 'panel is-refreshing' : 'panel'}>
        {!list.data && list.status === 'loading' ? (
          <Loading />
        ) : items.length === 0 ? (
          <EmptyText>조건에 맞는 사용자가 없습니다.</EmptyText>
        ) : (
          <table>
            <thead>
              <tr>
                <th>로그인ID</th>
                <th>이름</th>
                <th>이메일</th>
                <th>역할</th>
                <th>연결 강사</th>
                <th>상태</th>
                <th>등록일시</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.userId} className={u.status === 'ACTIVE' ? undefined : 'muted'}>
                  <td>{u.loginId}</td>
                  <td>{u.name}</td>
                  <td>{u.email ?? '-'}</td>
                  <td>{u.roleCode ? label(ROLE_LABELS, u.roleCode) : '-'}</td>
                  <td>{u.roleCode === 'INSTRUCTOR' ? instructorName(u.linkedInstructorId) : '-'}</td>
                  <td>
                    <span className={u.status === 'ACTIVE' ? 'badge badge-neutral' : 'badge badge-muted'}>{label(USER_STATUS_LABELS, u.status)}</span>
                    {u.mustChangePassword && <span className="muted"> · 비밀번호 변경 대기</span>}
                  </td>
                  <td>{formatDateTime(u.createdAt)}</td>
                  <td>
                    {can('S25', 'U') && (
                      <div className="row-actions">
                        <button type="button" onClick={() => setDialog({ kind: 'edit', user: u })} aria-label={`${u.loginId} 수정`}>
                          수정
                        </button>
                        <button type="button" onClick={() => setDialog({ kind: 'reset', user: u })} aria-label={`${u.loginId} 비밀번호 초기화`}>
                          비밀번호 초기화
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data && list.data.total > 0 && <Pagination page={list.data.page} size={list.data.size} total={list.data.total} onChange={(p) => set({ page: String(p) })} />}

      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <UserFormDialog
          user={dialog.kind === 'edit' ? dialog.user : undefined}
          instructors={instructors.data ?? []}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setNotice(result.message)
            list.reload()
            setDialog(result.tempPassword && result.loginId ? { kind: 'temp', loginId: result.loginId, tempPassword: result.tempPassword } : null)
          }}
        />
      )}
      {dialog?.kind === 'reset' && (
        <ResetPasswordDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={(tempPassword) => {
            setNotice(`${dialog.user.loginId}의 비밀번호를 초기화했습니다.`)
            list.reload()
            setDialog({ kind: 'temp', loginId: dialog.user.loginId, tempPassword })
          }}
        />
      )}
      {dialog?.kind === 'temp' && <TempPasswordDialog loginId={dialog.loginId} tempPassword={dialog.tempPassword} onClose={() => setDialog(null)} />}
    </section>
  )
}
