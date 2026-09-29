import { useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { PermissionAction, RoleGrant, RoleInfo } from '../../api/types'
import { useApi } from '../../api/useApi'
import { useAuth } from '../../auth/auth-context'
import { EmptyText, ErrorText } from '../../components/Feedback'
import { label, PERMISSION_ACTION_LABELS, ROLE_LABELS, SCOPE_LABELS, SCREEN_NAMES } from '../../labels'
import { useUrlFilters } from '../../routing/useUrlFilters'

const ACTIONS: PermissionAction[] = ['C', 'R', 'U', 'D', 'A']
const SCREENS = Object.keys(SCREEN_NAMES)
type Scope = RoleGrant['scope']

// S26 권한(system-design 7-A): 역할 × 화면 × 기능(C/R/U/D/A) 매트릭스. 4개 고정 역할(D-18)의 조회·조정만 한다.
// 범위(전체/본인 담당)는 화면 행 단위로 고른다. 저장은 역할의 매트릭스 전체 교체이며 바로 적용된다(감사로그 1건).
// S20 은 권한 행이 따로 없고 S19 권한을 쓴다. 시스템 관리자의 권한 화면(S26) 조회·저장은 뺄 수 없다(P5-09).
export function PermissionPage() {
  const { can } = useAuth()
  const { get, set } = useUrlFilters()
  const roles = useApi((signal) => api.get<{ items: RoleInfo[] }>('/roles', undefined, signal).then((r) => r.items), 'roles')
  const roleId = get('role_id') || (roles.data?.[0] ? String(roles.data[0].roleId) : '')
  const role = roles.data?.find((r) => String(r.roleId) === roleId)

  return (
    <section className="page">
      <div className="page-header">
        <h1>권한</h1>
      </div>
      <form className="filters filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          역할
          <select value={roleId} onChange={(e) => set({ role_id: e.target.value })}>
            {roles.data?.map((r) => (
              <option key={r.roleId} value={r.roleId}>
                {label(ROLE_LABELS, r.roleCode)}
              </option>
            ))}
          </select>
        </label>
      </form>
      {roles.status === 'error' && <ErrorText error={roles.error} onRetry={roles.reload} />}
      {role && <Matrix key={role.roleId} role={role} canSave={can('S26', 'U')} />}
    </section>
  )
}

function Matrix({ role, canSave }: { role: RoleInfo; canSave: boolean }) {
  const grants = useApi((signal) => api.get<{ items: RoleGrant[] }>('/roles/permissions', { role_id: role.roleId }, signal).then((r) => r.items), String(role.roleId))
  const [draft, setDraft] = useState<Map<string, Set<PermissionAction>> | null>(null)
  const [scopes, setScopes] = useState<Map<string, Scope> | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const defaultScope: Scope = role.roleCode === 'INSTRUCTOR' ? 'OWN_ASSIGNED' : 'ALL'

  if (grants.status === 'error') return <ErrorText error={grants.error} onRetry={grants.reload} />
  if (!grants.data) return <p className="muted">불러오는 중…</p>

  // 서버 값 → 화면 상태(편집 전에는 서버 값을 그대로 보여 준다)
  const saved = new Map<string, Set<PermissionAction>>()
  const savedScopes = new Map<string, Scope>()
  for (const g of grants.data) {
    if (!saved.has(g.screenId)) saved.set(g.screenId, new Set())
    saved.get(g.screenId)!.add(g.action)
    if (!savedScopes.has(g.screenId)) savedScopes.set(g.screenId, g.scope)
  }
  const current = draft ?? saved
  const currentScopes = scopes ?? savedScopes
  const scopeOf = (screen: string) => currentScopes.get(screen) ?? defaultScope
  const changed = SCREENS.filter(
    (s) => ACTIONS.some((a) => (current.get(s)?.has(a) ?? false) !== (saved.get(s)?.has(a) ?? false)) || ((current.get(s)?.size ?? 0) > 0 && scopeOf(s) !== (savedScopes.get(s) ?? defaultScope)),
  )

  const toggle = (screen: string, action: PermissionAction) => {
    const next = new Map([...current].map(([k, v]) => [k, new Set(v)]))
    const row = next.get(screen) ?? new Set<PermissionAction>()
    if (row.has(action)) row.delete(action)
    else row.add(action)
    next.set(screen, row)
    setDraft(next)
    setMessage(null)
  }
  const setScope = (screen: string, scope: Scope) => {
    setScopes(new Map(currentScopes).set(screen, scope))
    setMessage(null)
  }

  const save = async () => {
    const items: RoleGrant[] = []
    for (const screen of SCREENS) for (const action of ACTIONS) if (current.get(screen)?.has(action)) items.push({ screenId: screen, action, scope: scopeOf(screen) })
    setBusy(true)
    setMessage(null)
    try {
      await api.put(`/roles/${role.roleId}/permissions`, { items })
      setDraft(null)
      setScopes(null)
      grants.reload()
      setMessage({ kind: 'ok', text: `${label(ROLE_LABELS, role.roleCode)} 권한을 저장했습니다(화면 ${changed.length}개 변경). 해당 역할 사용자에게 바로 적용됩니다.` })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof ApiError ? e.message : '저장하지 못했습니다.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={grants.status === 'loading' ? 'panel is-refreshing' : 'panel'}>
      {canSave && (
        <div className="panel-header">
          <p className="muted">{changed.length > 0 ? `저장하지 않은 변경: 화면 ${changed.length}개` : '변경 없음'}</p>
          <div className="toolbar">
            <button
              type="button"
              disabled={changed.length === 0 || busy}
              onClick={() => {
                setDraft(null)
                setScopes(null)
                setMessage(null)
              }}
            >
              되돌리기
            </button>
            <button type="button" className="button-primary" disabled={changed.length === 0 || busy} onClick={() => void save()}>
              {busy ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p className={message.kind === 'ok' ? 'notice' : 'form-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
      {SCREENS.length === 0 ? (
        <EmptyText>화면이 없습니다.</EmptyText>
      ) : (
        <div className="matrix-wrap">
          <table className="matrix permission-matrix" aria-label={`${label(ROLE_LABELS, role.roleCode)} 권한`}>
            <thead>
              <tr>
                <th>화면</th>
                {ACTIONS.map((a) => (
                  <th key={a} className="round" title={PERMISSION_ACTION_LABELS[a]}>
                    {a}
                    <br />
                    {PERMISSION_ACTION_LABELS[a]}
                  </th>
                ))}
                <th>범위</th>
              </tr>
            </thead>
            <tbody>
              {SCREENS.map((screen) => {
                const row = current.get(screen)
                const isChanged = changed.includes(screen)
                return (
                  <tr key={screen} className={isChanged ? 'changed' : undefined}>
                    <th scope="row">
                      {screen} {SCREEN_NAMES[screen]}
                    </th>
                    {ACTIONS.map((a) => (
                      <td key={a} className="cell">
                        <input
                          type="checkbox"
                          aria-label={`${screen} ${PERMISSION_ACTION_LABELS[a]}`}
                          checked={row?.has(a) ?? false}
                          disabled={!canSave || screen === 'S20'}
                          onChange={() => toggle(screen, a)}
                        />
                      </td>
                    ))}
                    <td>
                      {(row?.size ?? 0) > 0 ? (
                        <select aria-label={`${screen} 범위`} value={scopeOf(screen)} disabled={!canSave} onChange={(e) => setScope(screen, e.target.value as Scope)}>
                          {Object.entries(SCOPE_LABELS).map(([code, text]) => (
                            <option key={code} value={code}>
                              {text}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint">S20(미제출)은 권한 행이 따로 없고 S19 권한을 따릅니다. "본인 담당"은 강사처럼 배정된 과정·회차만 보는 범위입니다.</p>
    </div>
  )
}
