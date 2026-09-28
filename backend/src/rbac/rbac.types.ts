import type pg from 'pg';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

export type PermissionAction = 'C' | 'R' | 'U' | 'D' | 'A';
export type PermissionScope = 'ALL' | 'OWN_ASSIGNED';

export const REQUIRE_PERMISSION_KEY = 'rbac:require-permission';
export interface RequiredPermission {
  screenId: string;
  action: PermissionAction;
}

// S28: 탐지규칙 파라미터 관리(Phase 5, migration 20260928000600)
export const SCREEN_ID_PATTERN = /^S(0[1-9]|1[0-9]|2[0-8])$/;

// 서비스들이 풀 또는 트랜잭션 클라이언트를 모두 받을 수 있게 하는 최소 인터페이스
export type Queryable = Pick<pg.Pool, 'query'>;

// 요청 단위 접근 컨텍스트: 가드가 권한 확인 후 채우고, 스코프 검증(V2·V4)이 사용한다.
export interface AccessContext {
  userId: number;
  roles: string[];
  /** user_account.linked_instructor_id (강사 계정). 없으면 OWN_ASSIGNED 범위는 아무것도 볼 수 없다 */
  instructorId: number | null;
  screenId: string;
  action: PermissionAction;
  scope: PermissionScope;
}

export interface RbacRequest extends AuthenticatedRequest {
  access?: AccessContext;
}
