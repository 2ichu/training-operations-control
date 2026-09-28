import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { SubmissionController } from './submission.controller.js';
import { SubmissionService } from './submission.service.js';

@Module({ imports: [RbacModule], controllers: [SubmissionController], providers: [SubmissionService] })
export class SubmissionModule {}
