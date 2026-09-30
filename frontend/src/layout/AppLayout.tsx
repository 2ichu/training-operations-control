import { useEffect, useState } from 'react'
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

// 그룹 머리글용 단순 선 아이콘(16px). 장식이 아니라 접힌 상태에서 그룹을 빠르게 찾기 위한 표식이다.
const GROUP_ICONS: Record<string, string> = {
  대시보드: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  '훈련생 관리': 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0112 0v1M17 11a3 3 0 100-6M18 14a5 5 0 013 5v2',
  '출결 관리': 'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M9 15l2 2 4-4',
  '강사 관리': 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0M17 3l3 3-3 3',
  '과정 운영': 'M4 5a2 2 0 012-2h12v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h12M9 8h6',
  '결과물 관리': 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  '확인/조치 관리': 'M12 3l9 16H3zM12 10v4M12 17v.5',
  '시스템 관리': 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 00-2-1.2L14 3h-4l-.6 2.7a7 7 0 00-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 002 1.2L10 21h4l.6-2.7a7 7 0 002-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
}

function GroupIcon({ name }: { name: string }) {
  const d = GROUP_ICONS[name]
  if (!d) return null
  return (
    <svg className="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const NAV_STORAGE_KEY = 'nav-open-groups'
function loadOpen(): string[] {
  try {
    const raw = window.localStorage.getItem(NAV_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function AppLayout() {
  const { logout } = useAuth()
  const { user, permissions } = useCurrentUser()
  const menu = visibleMenu(permissions)
  const { pathname } = useLocation()
  const here = locate(pathname)
  // 좌측 메뉴는 그룹별로 접고 펼친다(아코디언). 현재 화면이 속한 그룹은 항상 펼쳐지고, 사용자가 연 그룹은 기억한다.
  const [opened, setOpened] = useState<string[]>(loadOpen)
  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(opened))
    } catch {
      // 저장소를 쓸 수 없어도 메뉴는 동작한다
    }
  }, [opened])
  const toggle = (group: string) => setOpened((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]))

  // 초기 비밀번호 상태에서는 변경 화면만 메뉴 없이 보여준다(RequireAuth 가 다른 경로를 막는다)
  const isOpen = (group: string) => opened.includes(group) || here?.group === group

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
        <div className="app-nav-inner">
          {menu.map((group) => (
            <div key={group.label} className={group.items.length > 1 || group.items[0].label !== group.label ? 'nav-group' : 'nav-group nav-single'}>
              {group.items.length > 1 || group.items[0].label !== group.label ? (
                <>
                  <button type="button" className="nav-group-toggle" aria-expanded={isOpen(group.label)} onClick={() => toggle(group.label)}>
                    <GroupIcon name={group.label} />
                    <span>{group.label}</span>
                    <span className="nav-chevron" aria-hidden="true" />
                  </button>
                  <ul className={isOpen(group.label) ? 'nav-items open' : 'nav-items'}>
                    {group.items.map((item) => (
                      <li key={item.screenId}>
                        <NavLink to={item.path} end>
                          {item.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="nav-items open">
                  <li>
                    <NavLink to={group.items[0].path} end className="nav-top">
                      <GroupIcon name={group.label} />
                      {group.items[0].label}
                    </NavLink>
                  </li>
                </ul>
              )}
            </div>
          ))}
        </div>
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
