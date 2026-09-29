import { SCHEDULE_TIMEZONE } from '../schedule/schedule.service.js';

// D-04(#24, 2026-09-29 확정): 제출기한은 과정 공통 날짜(course.submission_due_date). 그날 24:00(기관 시간대) 이후 제출이면 기한후제출.
// 결과물 등록·재등록과 제출기한 변경 시 재판정이 같은 식을 쓴다. 인자는 SQL 식(컬럼명 또는 플레이스홀더).
export const submitStatusSql = (submittedAt: string, dueDate: string, tz: string): string =>
  `CASE WHEN ${dueDate} IS NOT NULL AND ${submittedAt} >= ((${dueDate} + 1)::timestamp AT TIME ZONE ${tz}) THEN 'LATE_SUBMITTED' ELSE 'SUBMITTED' END`;

export const SUBMIT_TIMEZONE = SCHEDULE_TIMEZONE;
