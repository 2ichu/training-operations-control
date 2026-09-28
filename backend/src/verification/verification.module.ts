import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { DetectionRuleService } from './detection-rule.service.js';
import { VerificationCaseController } from './verification-case.controller.js';
import { VerificationCaseService } from './verification-case.service.js';

// S22~S24 확인/조치 + Phase 3 탐지 엔진(RULE_01~06). 탐지 엔진은 HTTP 라우트 없이 서비스로만 노출한다(baseline 7절: 수동/서비스 호출).
@Module({ imports: [RbacModule], controllers: [VerificationCaseController], providers: [VerificationCaseService, DetectionRuleService], exports: [DetectionRuleService, VerificationCaseService] })
export class VerificationModule {}
