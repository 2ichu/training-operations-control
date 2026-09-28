import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { Authorize } from '../rbac/authorize.decorator.js';
import type { RbacRequest } from '../rbac/rbac.types.js';
import { DashboardService } from './dashboard.service.js';

// 화면: S01 대시보드 (baseline 5-2, system-design 7.1)
@Controller()
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get('dashboard')
  @Authorize('S01', 'R')
  summary(@Req() req: RbacRequest, @Query() query: Record<string, unknown>) {
    return this.dashboard.summary(req, query);
  }
}
