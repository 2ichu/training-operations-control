// 가중 출석률의 상태별 인정 가중치(decisions.md 6-1절 + 8-1절, 2026-09-29 확정).
// 지각·조퇴 0.5, 인정결석 1.0, 결석 0. 이 표 하나를 수료 후보(S02)와 과정별 출결 출석률(S08)이 함께 쓴다.
export const ATTENDANCE_WEIGHTS: Record<string, number> = {
  PRESENT: 1,
  LATE: 0.5,
  EARLY_LEAVE: 0.5,
  EXCUSED: 1,
  ABSENT: 0,
};
export const LATE_WEIGHT = ATTENDANCE_WEIGHTS.LATE;
export const EARLY_LEAVE_WEIGHT = ATTENDANCE_WEIGHTS.EARLY_LEAVE;
