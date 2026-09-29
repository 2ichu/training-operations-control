import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import { RolePermissionService } from './role-permission.service.js';

// 화면: S26 권한 (baseline 5-2)
@Controller('roles')
export class RolePermissionController {
  constructor(@Inject(RolePermissionService) private readonly permissions: RolePermissionService) {}

  // S26 역할 선택용 목록(4개 고정 역할 — D-18). 권한 조회·저장이 role_id 를 받으므로 화면이 역할 ID 를 알아야 한다
  @Get()
  @Authorize('S26', 'R')
  list() {
    return this.permissions.roles();
  }

  @Get('permissions')
  @Authorize('S26', 'R')
  get(@Query() query: Record<string, unknown>) {
    return this.permissions.get(query);
  }

  @Put(':id/permissions')
  @Authorize('S26', 'U')
  replace(@Param('id') id: string, @Body() body: unknown) {
    return this.permissions.replace(parseId(id), body);
  }
}
