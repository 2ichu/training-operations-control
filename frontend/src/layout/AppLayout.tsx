import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth, useCurrentUser } from '../auth/auth-context'
import { label, ROLE_LABELS } from '../labels'
import { MENU, visibleMenu } from '../menu'

/** 현재 경로에 해당하는 메뉴 그룹·항목(가장 긴 경로 일치)을 찾는다. 상세 화면은 목록 항목 아래로 묶인다. */
function locate(pathname: string): { group: string; item: string } | null {
  let best: { group: string; item: string; len: number } | null = null
  for (const g of MENU) {
    for (const it of g.items) {
      const match = it.path === '/' ? pathname === '/' : pathname === it.path || pathname.startsWith(it.path + '/')
      if (match && (!best || it.path.length > best.len)) best = { group: g.label, item: it.label, len: it.path.length }
    }
  }
  return best
}

export function AppLayout() {
  const { logout } = useAuth()
  const { user, permissions } = useCurrentUser()
  const menu = visibleMenu(permissions)
  const { pathname } = useLocation()
  const here = locate(pathname)

  // 초기 비밀번호 상태에서는 변경 화면만 메뉴 없이 보여준다(RequireAuth 가 다른 경로를 막는다)
  if (user.mustChangePassword) return <Outlet />

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">훈련과정 통합관리</span>
        <div className="breadcrumb" role="group" aria-label="현재 위치">
          {here ? (
            <>
              <span>{here.group}</span>
              {here.group !== here.item ? (
                <>
                  <span className="breadcrumb-sep" aria-hidden="true">
                    /
                  </span>
                  <span aria-current="page">{here.item}</span>
                </>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="app-user">
          <span className="app-user-name">
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
