// 배치 실행 시각 계산. 스케줄은 벽시계 기준(APP_TIMEZONE, 기본 Asia/Seoul)이며 외부 cron 라이브러리 없이 계산한다.
export type BatchSchedule = { kind: 'hourly'; minute: number } | { kind: 'daily'; hour: number; minute: number };

const MINUTE = 60_000;
const SEARCH_LIMIT_MINUTES = 2 * 24 * 60; // 매일 스케줄이면 최대 하루 + 여유분 안에 반드시 찾는다

function wallClock(date: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { hour: get('hour'), minute: get('minute') };
}

/** now 이후(같은 분 제외) 스케줄에 맞는 첫 시각. 분 단위로 탐색하므로 서머타임이 있는 시간대에서도 벽시계 기준이 유지된다. */
export function nextRunAt(schedule: BatchSchedule, now: Date, timeZone: string): Date {
  let t = Math.floor(now.getTime() / MINUTE) * MINUTE + MINUTE;
  for (let i = 0; i < SEARCH_LIMIT_MINUTES; i += 1, t += MINUTE) {
    const { hour, minute } = wallClock(new Date(t), timeZone);
    if (minute !== schedule.minute) continue;
    if (schedule.kind === 'hourly' || hour === schedule.hour) return new Date(t);
  }
  throw new Error(`실행 시각을 찾을 수 없습니다: ${JSON.stringify(schedule)}`);
}
