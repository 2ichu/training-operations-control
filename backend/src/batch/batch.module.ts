import { Module } from '@nestjs/common';
import { CourseModule } from '../course/course.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { BatchSchedulerService } from './batch-scheduler.service.js';

// Phase 5: 화면이 없는 내부 처리(baseline 5-3)의 시간 기반 배치. HTTP 라우트 없음.
@Module({ imports: [CourseModule, VerificationModule], providers: [BatchSchedulerService], exports: [BatchSchedulerService] })
export class BatchModule {}
