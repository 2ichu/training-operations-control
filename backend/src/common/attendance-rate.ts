// 출석률 산식(2026-09-29 확정, 공식 출석부와 같은 방식). 수료 후보(S02)와 과정별 출결(S08)이 함께 쓴다.
// 출석일수 = 출석 + 지각 + 조퇴 + 인정결석 − ⌊(지각 + 조퇴) ÷ 3⌋   (지각·조퇴 3회 = 결석 1일로 환산)
// 출석률 = 출석일수 ÷ 적용 가능 회차(휴강 제외, 미출결·결석 포함). 결석은 출석일수에 들어가지 않는다.
// 지각·조퇴는 합산해 3회마다 결석 1일이다(공식 출석부 샘플의 요약 열과 대조해 확인).
export const LATE_TO_ABSENCE = 3;

export interface AttendanceCounts {
  present: number;
  late: number;
  earlyLeave: number;
  excused: number;
}

export function attendedDays(c: AttendanceCounts): number {
  return c.present + c.late + c.earlyLeave + c.excused - Math.floor((c.late + c.earlyLeave) / LATE_TO_ABSENCE);
}
