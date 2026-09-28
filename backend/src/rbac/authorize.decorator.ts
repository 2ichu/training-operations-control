import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { type PermissionAction, REQUIRE_PERMISSION_KEY, type RequiredPermission, SCREEN_ID_PATTERN } from './rbac.types.js';

// 엔드포인트가 요구하는 화면×기능. 로그인(세션) 검사 → 권한 검사 순으로 가드를 적용한다.
// 사용: @Authorize('S13', 'C')  — baseline 5-2 표의 화면 ID와 role_permission(C/R/U/D/A)에 대응
export function Authorize(screenId: string, action: PermissionAction) {
  if (!SCREEN_ID_PATTERN.test(screenId)) throw new Error(`잘못된 화면 ID: ${screenId}`);
  return applyDecorators(
    SetMetadata(REQUIRE_PERMISSION_KEY, { screenId, action } satisfies RequiredPermission),
    UseGuards(SessionAuthGuard, PermissionGuard),
  );
}
