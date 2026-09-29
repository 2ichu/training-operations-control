import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { Authorize } from '../rbac/authorize.decorator.js';
import { AttendanceSettingService } from './attendance-setting.service.js';

// 화면: S28 탐지규칙·판정 기준 관리의 "지각·조퇴 판정" 구역(D-08 확정, SYS_ADMIN 전용)
@Controller('attendance-settings')
export class AttendanceSettingController {
  constructor(@Inject(AttendanceSettingService) private readonly settings: AttendanceSettingService) {}

  @Get()
  @Authorize('S28', 'R')
  get() {
    return this.settings.get();
  }

  @Patch()
  @Authorize('S28', 'U')
  update(@Body() body: unknown) {
    return this.settings.update(body);
  }
}
