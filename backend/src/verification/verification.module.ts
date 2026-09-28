import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { DetectionEventService } from './detection-event.service.js';
import { DetectionRuleAdminService } from './detection-rule-admin.service.js';
import { DetectionRuleController } from './detection-rule.controller.js';
import { DetectionRuleService } from './detection-rule.service.js';
import { VerificationCaseController } from './verification-case.controller.js';
import { VerificationCaseService } from './verification-case.service.js';

// S22~S24 확인/조치 + 탐지 엔진(RULE_01~06) + S28 탐지규칙 파라미터 관리. 탐지 실행 자체는 HTTP 라우트 없이
// 배치(BatchModule)·출결 이벤트(DetectionEventService)·직접 호출로만 동작한다.
@Module({
  imports: [RbacModule],
  controllers: [VerificationCaseController, DetectionRuleController],
  providers: [VerificationCaseService, DetectionRuleService, DetectionRuleAdminService, DetectionEventService],
  exports: [DetectionRuleService, VerificationCaseService, DetectionEventService],
})
export class VerificationModule {}
