import { type BeforeApplicationShutdown, Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CourseService } from '../course/course.service.js';
import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';
import { DetectionRuleService } from '../verification/detection-rule.service.js';
import { type BatchSchedule, nextRunAt } from './next-run.js';

export interface BatchJob {
  name: string;
  schedule: BatchSchedule;
  run: () => Promise<unknown>;
}

// 화면이 없는 내부 처리(baseline 5-3)의 시간 기반 배치. 실행 시점은 baseline 6절 시점표·5-3을 따르고,
// 시점표가 "매일 1회"·"익일 오전"처럼 시각을 정하지 않은 항목만 아래 기술적 기본값으로 정했다(정책값 아님).
// 행위자 태깅은 각 서비스가 한다(탐지 = SYSTEM_RULE, 과정 자동 전환 = SYSTEM_BATCH). 실패는 로그만 남기고 다음 주기에 재시도한다
// (모든 작업이 멱등). 같은 작업이 아직 실행 중이면 이번 주기는 건너뛴다.
@Injectable()
export class BatchSchedulerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('BatchScheduler');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(DetectionRuleService) private readonly detection: DetectionRuleService,
    @Inject(CourseService) private readonly courses: CourseService,
  ) {}

  jobs(): BatchJob[] {
    return [
      // P1-10: 매일 자정 직후
      { name: 'course-auto-start', schedule: { kind: 'daily', hour: 0, minute: 5 }, run: () => this.courses.autoStartDue() },
      // RULE_03: 매시 정각
      { name: 'RULE_03', schedule: { kind: 'hourly', minute: 0 }, run: () => this.detection.runRule03() },
      // RULE_04: 매일 22:00 + 익일 오전 재확인(09:00 은 기술적 기본값)
      { name: 'RULE_04', schedule: { kind: 'daily', hour: 22, minute: 0 }, run: () => this.detection.runRule04() },
      { name: 'RULE_04-recheck', schedule: { kind: 'daily', hour: 9, minute: 0 }, run: () => this.detection.runRule04() },
      // RULE_05·06: 매일 1회(01:00 은 기술적 기본값 — 전일 수정분까지 집계되도록 자정 이후)
      { name: 'RULE_05', schedule: { kind: 'daily', hour: 1, minute: 0 }, run: () => this.detection.runRule05() },
      { name: 'RULE_06', schedule: { kind: 'daily', hour: 1, minute: 10 }, run: () => this.detection.runRule06() },
    ];
  }

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('batch.enabled')) {
      this.logger.log('BATCH_ENABLED=false — 시간 기반 배치를 시작하지 않습니다');
      return;
    }
    for (const job of this.jobs()) this.scheduleNext(job);
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled(this.running.values());
  }

  /** 한 번 실행한다(겹침 방지·오류 격리 포함). 스케줄러 내부와 테스트에서 쓴다. */
  async runJob(job: BatchJob): Promise<void> {
    if (this.running.has(job.name)) {
      this.logger.warn(`${job.name}: 이전 실행이 끝나지 않아 이번 주기를 건너뜁니다`);
      return;
    }
    const execution = (async () => {
      const startedAt = Date.now();
      try {
        const result = await job.run();
        this.logger.log(`${job.name} 완료 (${Date.now() - startedAt}ms) ${JSON.stringify(result)}`);
      } catch (error) {
        this.logger.error(`${job.name} 실패 — 다음 주기에 재시도합니다: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    this.running.set(job.name, execution);
    try {
      await execution;
    } finally {
      this.running.delete(job.name);
    }
  }

  private scheduleNext(job: BatchJob): void {
    if (this.stopped) return;
    const at = nextRunAt(job.schedule, new Date(), SCHEDULE_TIMEZONE);
    const timer = setTimeout(() => {
      void this.runJob(job).finally(() => this.scheduleNext(job));
    }, at.getTime() - Date.now());
    timer.unref();
    this.timers.set(job.name, timer);
  }
}
