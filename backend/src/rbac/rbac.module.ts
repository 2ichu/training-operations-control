import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PermissionGuard } from './permission.guard.js';
import { PermissionService } from './permission.service.js';
import { ScopeService } from './scope.service.js';

// @Authorize 를 쓰는 모듈은 이 모듈만 import 하면 된다(가드가 필요로 하는 세션 서비스는 AuthModule 을 재수출).
@Module({
  imports: [AuthModule],
  providers: [PermissionService, ScopeService, PermissionGuard],
  exports: [AuthModule, PermissionService, ScopeService, PermissionGuard],
})
export class RbacModule {}
