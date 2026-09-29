import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { CourseService } from '../course/course.service.js';
import { mergeParams } from '../verification/detection-rule-admin.service.js';
import type { DetectionRuleService } from '../verification/detection-rule.service.js';
import { BatchSchedulerService } from './batch-scheduler.service.js';
import { nextRunAt } from './next-run.js';

const config = (enabled: boolean) => ({ get: (key: string) => (key === 'batch.enabled' ? enabled : undefined) }) as unknown as ConfigService;

describe('nextRunAt (Asia/Seoul 벽시계 기준)', () => {
  const tz = 'Asia/Seoul';
  it('매일 00:05 — 당일 시각이 지났으면 다음 날', () => {
    // 2026-09-28 10:00 KST = 01:00Z
    expect(nextRunAt({ kind: 'daily', hour: 0, minute: 5 }, new Date('2026-09-28T01:00:00Z'), tz).toISOString()).toBe('2026-09-28T15:05:00.000Z');
  });
  it('매일 22:00 — 당일 시각 전이면 당일', () => {
    expect(nextRunAt({ kind: 'daily', hour: 22, minute: 0 }, new Date('2026-09-28T01:00:00Z'), tz).toISOString()).toBe('2026-09-28T13:00:00.000Z');
  });
  it('정확히 실행 시각이면 같은 분은 건너뛰고 다음 주기', () => {
    expect(nextRunAt({ kind: 'daily', hour: 22, minute: 0 }, new Date('2026-09-28T13:00:00Z'), tz).toISOString()).toBe('2026-09-29T13:00:00.000Z');
    expect(nextRunAt({ kind: 'hourly', minute: 0 }, new Date('2026-09-28T13:00:30Z'), tz).toISOString()).toBe('2026-09-28T14:00:00.000Z');
  });
  it('매시 정각', () => {
    expect(nextRunAt({ kind: 'hourly', minute: 0 }, new Date('2026-09-28T13:59:59Z'), tz).toISOString()).toBe('2026-09-28T14:00:00.000Z');
  });
});

describe('BatchSchedulerService', () => {
  const scheduler = () => new BatchSchedulerService(config(true), {} as DetectionRuleService, {} as CourseService);

  it('baseline 6절·5-3 시점표의 작업이 등록되어 있다(RULE_01·02 는 도입하지 않고, RULE_07 은 배치가 아니라 공식 출결 업로드가 호출)', () => {
    expect(scheduler().jobs().map((j) => j.name)).toEqual(['course-auto-start', 'RULE_03', 'RULE_04', 'RULE_04-recheck', 'RULE_05', 'RULE_06']);
  });

  it('작업 실패는 삼키고(다음 주기 재시도), 실행 중인 같은 작업은 겹쳐 실행하지 않는다', async () => {
    const s = scheduler();
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const job = { name: 'slow', schedule: { kind: 'hourly', minute: 0 } as const, run };
    const first = s.runJob(job);
    await s.runJob(job); // 첫 실행이 끝나지 않음 → 건너뜀
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    await expect(s.runJob({ ...job, run: () => Promise.reject(new Error('boom')) })).resolves.toBeUndefined();
  });

  it('BATCH_ENABLED=false 면 타이머를 만들지 않는다', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    new BatchSchedulerService(config(false), {} as DetectionRuleService, {} as CourseService).onApplicationBootstrap();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('mergeParams (S28 파라미터 검증)', () => {
  const current = { min_trainees: 3, window_minutes: 10 };
  it('기존 키의 값만 부분 갱신한다', () => {
    expect(mergeParams(current, { window_minutes: 15 })).toEqual({ min_trainees: 3, window_minutes: 15 });
  });
  it.each([
    [{ unknown_key: 1 }, 'params.unknown_key'],
    [{ min_trainees: 0 }, 'params.min_trainees'],
    [{ min_trainees: 2.5 }, 'params.min_trainees'],
    [{ min_trainees: '3' }, 'params.min_trainees'],
    [{ min_trainees: 100_001 }, 'params.min_trainees'],
    [{}, 'params'],
    [[1], 'params'],
    [null, 'params'],
  ])('거부: %j', (input, field) => {
    expect(() => mergeParams(current, input)).toThrow(expect.objectContaining({ response: expect.objectContaining({ field }) }));
  });
});
