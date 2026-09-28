import { Body, Controller, Get, Inject, Param, Patch } from '@nestjs/common';
import { parseId } from '../common/validation.js';
import { Authorize } from '../rbac/authorize.decorator.js';
import { DetectionRuleAdminService } from './detection-rule-admin.service.js';

// 화면: S28 탐지규칙 파라미터 관리 (Phase 5, SYS_ADMIN 전용)
@Controller('detection-rules')
export class DetectionRuleController {
  constructor(@Inject(DetectionRuleAdminService) private readonly rules: DetectionRuleAdminService) {}

  @Get()
  @Authorize('S28', 'R')
  list() {
    return this.rules.list();
  }

  @Patch(':id')
  @Authorize('S28', 'U')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.rules.update(parseId(id), body);
  }
}
