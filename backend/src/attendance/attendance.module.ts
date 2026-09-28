import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({ imports: [RbacModule, VerificationModule], controllers: [AttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}
