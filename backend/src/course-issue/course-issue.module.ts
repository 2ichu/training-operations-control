import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { CourseIssueController } from './course-issue.controller.js';
import { CourseIssueService } from './course-issue.service.js';

@Module({ imports: [RbacModule], controllers: [CourseIssueController], providers: [CourseIssueService] })
export class CourseIssueModule {}
