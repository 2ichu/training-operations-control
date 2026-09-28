import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { ScheduleController } from './schedule.controller.js';
import { ScheduleService } from './schedule.service.js';

@Module({ imports: [RbacModule], controllers: [ScheduleController], providers: [ScheduleService] })
export class ScheduleModule {}
