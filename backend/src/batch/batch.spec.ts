import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { CourseService } from '../course/course.service.js';
import { DetectionEventService } from '../verification/detection-event.service.js';
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

  it('baseline 6절·5-3 시점표의 작업 + RULE_01·02 일일 보정이 등록되어 있다(RULE_07 은 D-12 미확정으로 제외)', () => {
    expect(scheduler().jobs().map((j) => j.name)).toEqual(['course-auto-start', 'RULE_03', 'RULE_04', 'RULE_04-recheck', 'RULE_05', 'RULE_06', 'RULE_01-catchup', 'RULE_02-catchup']);
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

describe('DetectionEventService (RULE_01·02 출결 이벤트 평가)', () => {
  const detection = () => ({
    runRule01: vi.fn(async () => ({ skipped: false, casesCreated: 0, casesUpdated: 0 })),
    runRule02: vi.fn(async () => ({ skipped: false, casesCreated: 0, casesUpdated: 0 })),
  });

  it('device_id 가 있으면 RULE_01, channel 이 있으면 RULE_02 를 해당 회차로만 평가한다', async () => {
    const d = detection();
    const events = new DetectionEventService(d as unknown as DetectionRuleService, config(true));
    events.attendanceCheckedIn(7, { device_id: 'dev-1' });
    events.attendanceCheckedIn(8, { channel: 'kiosk-1', device_id: 'dev-2' });
    events.attendanceCheckedIn(9, { note: 'x' }); // 평가 대상 아님
    events.attendanceCheckedIn(10, undefined);
    await events.drain();
    expect(d.runRule01.mock.calls).toEqual([[{ scheduleId: 7 }], [{ scheduleId: 8 }]]);
    expect(d.runRule02.mock.calls).toEqual([[{ scheduleId: 8 }]]);
  });

  it('한 규칙이 실패해도 다음 규칙·다음 이벤트는 계속 평가한다', async () => {
    const d = detection();
    d.runRule01.mockRejectedValueOnce(new Error('db down'));
    const events = new DetectionEventService(d as unknown as DetectionRuleService, config(true));
    events.attendanceCheckedIn(1, { device_id: 'a', channel: 'c' });
    events.attendanceCheckedIn(2, { device_id: 'b' });
    await events.drain();
    expect(d.runRule02).toHaveBeenCalledWith({ scheduleId: 1 });
    expect(d.runRule01).toHaveBeenLastCalledWith({ scheduleId: 2 });
  });

  it('BATCH_ENABLED=false 면 아무것도 평가하지 않는다', async () => {
    const d = detection();
    const events = new DetectionEventService(d as unknown as DetectionRuleService, config(false));
    events.attendanceCheckedIn(1, { device_id: 'a' });
    await events.drain();
    expect(d.runRule01).not.toHaveBeenCalled();
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
