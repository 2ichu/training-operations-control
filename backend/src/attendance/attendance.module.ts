import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { AttendanceSettingController } from './attendance-setting.controller.js';
import { AttendanceSettingService } from './attendance-setting.service.js';
import { OfficialAttendanceController } from './official-attendance.controller.js';
import { OfficialAttendanceService } from './official-attendance.service.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  imports: [RbacModule, VerificationModule],
  controllers: [AttendanceController, AttendanceSettingController, OfficialAttendanceController],
  providers: [AttendanceService, AttendanceSettingService, OfficialAttendanceService],
})
export class AttendanceModule {}
