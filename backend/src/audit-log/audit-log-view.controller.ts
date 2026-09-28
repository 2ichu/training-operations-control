import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import { AuditLogViewService } from './audit-log-view.service.js';

// 화면: S27 감사로그 (baseline 5-2, V9)
@Controller('audit-logs')
export class AuditLogViewController {
  constructor(@Inject(AuditLogViewService) private readonly logs: AuditLogViewService) {}

  @Get()
  @Authorize('S27', 'R')
  list(@Query() query: Record<string, unknown>) {
    return this.logs.list(query);
  }

  @Get(':id')
  @Authorize('S27', 'R')
  detail(@Param('id') id: string) {
    return this.logs.detail(parseId(id));
  }
}
