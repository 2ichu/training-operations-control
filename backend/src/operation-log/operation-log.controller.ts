import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { OperationLogService } from './operation-log.service.js';

// 화면: S17 회차별 운영일지 (baseline 5-2, Phase 2)
@Controller()
export class OperationLogController {
  constructor(@Inject(OperationLogService) private readonly operationLogs: OperationLogService) {}

  @Get('courses/:id/operation-logs')
  @Authorize('S17', 'R')
  list(@Req() req: RbacRequest, @Param('id') id: string, @Query() query: Record<string, unknown>) {
    return this.operationLogs.list(req, parseId(id), query);
  }

  @Get('schedules/:id/operation-log')
  @Authorize('S17', 'R')
  detail(@Req() req: RbacRequest, @Param('id') id: string) {
    return this.operationLogs.detail(req, parseId(id));
  }

  @Post('schedules/:id/operation-log')
  @Authorize('S17', 'C')
  create(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.operationLogs.create(req, parseId(id), body);
  }

  @Patch('operation-logs/:id')
  @Authorize('S17', 'U')
  update(@Req() req: RbacRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.operationLogs.update(req, parseId(id), body);
  }
}
