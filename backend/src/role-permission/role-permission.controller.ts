import { Body, Controller, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import { RolePermissionService } from './role-permission.service.js';

// 화면: S26 권한 (baseline 5-2)
@Controller('roles')
export class RolePermissionController {
  constructor(@Inject(RolePermissionService) private readonly permissions: RolePermissionService) {}

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
