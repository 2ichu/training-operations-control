import { Module } from '@nestjs/common';
import { CourseModule } from '../course/course.module.js';
import { RbacModule } from '../rbac/rbac.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({ imports: [RbacModule, CourseModule, VerificationModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
