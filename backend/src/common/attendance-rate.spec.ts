import { describe, expect, it } from 'vitest';
import { attendedDays } from './attendance-rate.js';

describe('attendedDays (지각·조퇴 3회 = 결석 1일)', () => {
  const base = { present: 0, late: 0, earlyLeave: 0, excused: 0 };
  it('지각·조퇴는 합산해 3회마다 1일이 빠진다', () => {
    expect(attendedDays({ ...base, present: 10 })).toBe(10);
    expect(attendedDays({ ...base, present: 10, late: 2 })).toBe(12); // 2회는 환산 없음
    expect(attendedDays({ ...base, present: 10, late: 3 })).toBe(12); // 13 − 1
    expect(attendedDays({ ...base, present: 8, late: 2, earlyLeave: 1 })).toBe(10); // 합 3 → −1
    expect(attendedDays({ ...base, late: 4, earlyLeave: 2 })).toBe(4); // 합 6 → −2
  });
  it('인정결석은 전액 출석일수, 공식 출석부 샘플 행과 일치한다', () => {
    // 샘플 6번 훈련생: ○8 ▲4 ▦1 ×2(15일) → 출석일수 12, 결석 3
    expect(attendedDays({ present: 8, late: 0, earlyLeave: 4, excused: 1 })).toBe(12);
    // 샘플 13번: ○10 ◎3 ▦1 ×1 → 출석일수 13
    expect(attendedDays({ present: 10, late: 3, earlyLeave: 0, excused: 1 })).toBe(13);
    // 샘플 8번: ○12 ▲2 ◎1(×없음, 15일) → 12 + 3 − 1 = 14
    expect(attendedDays({ present: 12, late: 1, earlyLeave: 2, excused: 0 })).toBe(14);
  });
});
