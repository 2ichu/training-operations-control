import type { Queryable } from '../rbac/rbac.types.js';

// 기준 시간대(APP_TIMEZONE, 기본 Asia/Seoul — decisions.md P1-20)의 오늘 날짜(YYYY-MM-DD).
// 서버 시계·시간대와 무관하게 DB now() 를 기준으로 계산한다(일정의 "진행완료" 계산값과 같은 기준).
// new Date().toISOString() 은 UTC 날짜라 KST 00:00~09:00 에 하루 전 날짜가 된다 — 날짜 기본값에는 이 함수를 쓴다.
export async function todayIn(db: Queryable, timeZone: string): Promise<string> {
  const { rows } = await db.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS d`, [timeZone]);
  return rows[0].d as string;
}
