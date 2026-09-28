import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({ imports: [RbacModule], controllers: [AttendanceController], providers: [AttendanceService] })
export class AttendanceModule {}
