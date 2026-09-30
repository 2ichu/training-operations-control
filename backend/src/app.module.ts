import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AttachmentModule } from './attachment/attachment.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuditLogViewModule } from './audit-log/audit-log-view.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BatchModule } from './batch/batch.module.js';
import authConfig from './auth/auth.config.js';
import { CommonModule } from './common/common.module.js';
import { CourseIssueModule } from './course-issue/course-issue.module.js';
import { CourseModule } from './course/course.module.js';
import { ExcuseModule } from './excuse/excuse.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { InstructorModule } from './instructor/instructor.module.js';
import { OperationLogModule } from './operation-log/operation-log.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { RolePermissionModule } from './role-permission/role-permission.module.js';
import { ScheduleModule } from './schedule/schedule.module.js';
import { SubmissionModule } from './submission/submission.module.js';
import { TraineeModule } from './trainee/trainee.module.js';
import { UserModule } from './user/user.module.js';
import { VerificationModule } from './verification/verification.module.js';
import batchConfig from './config/batch.config.js';
import databaseConfig from './config/database.config.js';
import { DatabaseModule } from './database/database.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig, authConfig, batchConfig] }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    RbacModule,
    CommonModule,
    CourseModule,
    InstructorModule,
    TraineeModule,
    ScheduleModule,
    RolePermissionModule,
    AuditLogViewModule,
    UserModule,
    AttendanceModule,
    OperationLogModule,
    CourseIssueModule,
    VerificationModule,
    SubmissionModule,
    AttachmentModule,
    ExcuseModule,
    DashboardModule,
    BatchModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
