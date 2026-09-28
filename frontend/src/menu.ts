import type { PermissionGrant } from './api/types'
import { can } from './auth/permissions'

// system-design STEP 3.2 메뉴 구조. 각 항목은 해당 화면의 조회(R) 권한이 있을 때만 보인다.
// S20(미제출)은 권한 행이 따로 없고 S19 API 를 재사용하므로 S19 권한으로 판정한다(backend seed/permissions.ts).
// S28(탐지규칙)은 Phase 5 에서 추가된 시스템 관리 하위 화면이다.
export interface MenuItem {
  screenId: string
  label: string
  path: string
  permissionScreen?: string
}

export interface MenuGroup {
  label: string
  items: MenuItem[]
}

export const MENU: MenuGroup[] = [
  { label: '대시보드', items: [{ screenId: 'S01', label: '대시보드', path: '/' }] },
  {
    label: '훈련생 관리',
    items: [
      { screenId: 'S02', label: '대상자 확인', path: '/enrollments' },
      { screenId: 'S03', label: '훈련생 목록', path: '/trainees' },
      { screenId: 'S06', label: '변경이력', path: '/trainee-change-logs' },
    ],
  },
  {
    label: '출결 관리',
    items: [
      { screenId: 'S07', label: '일일 출결', path: '/attendance/daily' },
      { screenId: 'S08', label: '과정별 출결', path: '/attendance/course' },
      { screenId: 'S10', label: '출결 수정이력', path: '/attendance-change-logs' },
    ],
  },
  {
    label: '강사 관리',
    items: [
      { screenId: 'S11', label: '강사 목록', path: '/instructors' },
      { screenId: 'S13', label: '강의 일정', path: '/schedules' },
      { screenId: 'S14', label: '강사 변경이력', path: '/instructor-change-logs' },
    ],
  },
  {
    label: '과정 운영',
    items: [
      { screenId: 'S15', label: '과정 목록', path: '/courses' },
      { screenId: 'S17', label: '회차별 운영일지', path: '/operation-logs' },
      { screenId: 'S18', label: '특이사항', path: '/course-issues' },
    ],
  },
  {
    label: '결과물 관리',
    items: [
      { screenId: 'S19', label: '제출현황', path: '/submissions' },
      { screenId: 'S20', label: '미제출', path: '/submissions/missing', permissionScreen: 'S19' },
      { screenId: 'S21', label: '검토이력', path: '/submission-reviews' },
    ],
  },
  {
    label: '확인/조치 관리',
    items: [
      { screenId: 'S22', label: '확인 필요 목록', path: '/verification-cases' },
      { screenId: 'S24', label: '조치이력', path: '/verification-action-logs' },
    ],
  },
  {
    label: '시스템 관리',
    items: [
      { screenId: 'S25', label: '사용자', path: '/admin/users' },
      { screenId: 'S26', label: '권한', path: '/admin/permissions' },
      { screenId: 'S27', label: '감사로그', path: '/admin/audit-logs' },
      { screenId: 'S28', label: '탐지규칙', path: '/admin/detection-rules' },
    ],
  },
]

/** 권한이 있는 항목만 남기고, 빈 그룹은 뺀다. */
export function visibleMenu(permissions: readonly PermissionGrant[]): MenuGroup[] {
  return MENU.map((group) => ({ ...group, items: group.items.filter((item) => can(permissions, item.permissionScreen ?? item.screenId, 'R')) })).filter(
    (group) => group.items.length > 0,
  )
}

// 화면이 구현된 메뉴 경로. 나머지 메뉴는 라우터가 "준비 중" 안내를 보여준다.
const IMPLEMENTED_PATHS = new Set(['/', '/verification-cases', '/verification-action-logs', '/courses', '/enrollments', '/trainees', '/trainee-change-logs'])
export const PLANNED_PATHS = MENU.flatMap((g) => g.items).filter((i) => !IMPLEMENTED_PATHS.has(i.path))
