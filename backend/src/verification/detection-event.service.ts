import { type BeforeApplicationShutdown, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Obj } from '../common/validation.js';
import { DetectionRuleService } from './detection-rule.service.js';

// baseline 5-3·6절: RULE_01·02 는 "attendance INSERT 커밋 후 즉시(비동기), 출결 저장을 지연시키지 않음".
// 입실 확인 트랜잭션이 커밋된 뒤 AttendanceService 가 호출하며, 응답은 기다리지 않는다. 평가는 프로세스 안에서 한 줄로 직렬화하고
// 해당 회차만 대상으로 한다. 평가 실패는 출결 저장에 영향을 주지 않고 로그만 남긴다 — 놓친 건은 전체 평가(runRule01/02 인자 없이)로
// 다시 잡을 수 있다(멱등). related_info 에 device_id·channel 이 없는 출결(내부수기 등)은 평가 대상이 아니다(baseline 6절 예외조건).
@Injectable()
export class DetectionEventService implements BeforeApplicationShutdown {
  private readonly logger = new Logger('DetectionEvent');
  private readonly enabled: boolean;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DetectionRuleService) private readonly detection: DetectionRuleService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('batch.enabled') === true;
  }

  attendanceCheckedIn(scheduleId: number, relatedInfo: Obj | undefined): void {
    if (!this.enabled || !relatedInfo) return;
    const rules: ('RULE_01' | 'RULE_02')[] = [];
    if (relatedInfo.device_id !== undefined && relatedInfo.device_id !== null) rules.push('RULE_01');
    if (relatedInfo.channel !== undefined && relatedInfo.channel !== null) rules.push('RULE_02');
    if (rules.length === 0) return;
    this.queue = this.queue.then(() => this.evaluate(scheduleId, rules));
  }

  /** 대기 중인 평가가 모두 끝나면 resolve 된다(종료·테스트용). */
  drain(): Promise<void> {
    return this.queue;
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.drain();
  }

  private async evaluate(scheduleId: number, rules: ('RULE_01' | 'RULE_02')[]): Promise<void> {
    for (const rule of rules) {
      try {
        const result = rule === 'RULE_01' ? await this.detection.runRule01({ scheduleId }) : await this.detection.runRule02({ scheduleId });
        if (result.casesCreated > 0 || result.casesUpdated > 0) this.logger.log(`${rule} schedule=${scheduleId} ${JSON.stringify(result)}`);
      } catch (error) {
        this.logger.error(`${rule} schedule=${scheduleId} 평가 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
