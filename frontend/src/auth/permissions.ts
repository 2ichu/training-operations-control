import type { PermissionAction, PermissionGrant } from '../api/types'

// 화면 권한 판정(메뉴·버튼 노출용). 통제 수단은 서버의 요청별 재검증이며(system-design 2.3), 여기는 사용성 보조일 뿐이다.
export function can(permissions: readonly PermissionGrant[], screenId: string, action: PermissionAction = 'R'): boolean {
  return permissions.some((p) => p.screenId === screenId && p.action === action)
}
