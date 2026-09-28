import { NavLink, Outlet } from 'react-router'
import { useAuth, useCurrentUser } from '../auth/auth-context'
import { label, ROLE_LABELS } from '../labels'
import { visibleMenu } from '../menu'

export function AppLayout() {
  const { logout } = useAuth()
  const { user, permissions } = useCurrentUser()
  const menu = visibleMenu(permissions)

  // 초기 비밀번호 상태에서는 변경 화면만 메뉴 없이 보여준다(RequireAuth 가 다른 경로를 막는다)
  if (user.mustChangePassword) return <Outlet />

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">훈련과정 통합관리</span>
        <div className="app-user">
          <span>
            {user.name} <span className="muted">({user.roles.map((r) => label(ROLE_LABELS, r)).join(', ')})</span>
          </span>
          <NavLink to="/change-password">비밀번호 변경</NavLink>
          <button type="button" className="button-link" onClick={() => void logout()}>
            로그아웃
          </button>
        </div>
      </header>
      <nav className="app-nav" aria-label="주 메뉴">
        {menu.map((group) => (
          <div key={group.label} className="nav-group">
            {group.items.length > 1 || group.items[0].label !== group.label ? <div className="nav-group-label">{group.label}</div> : null}
            <ul>
              {group.items.map((item) => (
                <li key={item.screenId}>
                  <NavLink to={item.path} end>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
