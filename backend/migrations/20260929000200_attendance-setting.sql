-- Up Migration
-- D-08 확정(자동 판정, 유예 10분): 지각·조퇴 판정 유예분을 코드 상수가 아닌 설정값으로 둔다(decisions.md 8절).
-- 단일 행 설정 테이블(setting_id = 1 고정). S28 에서 SYS_ADMIN 이 사유와 함께 조정하며, 변경은 audit_log 로만 추적한다.
-- 변경된 값은 이후 입실·퇴실 확인부터 적용된다(이미 저장된 상태는 다시 판정하지 않음 — 생성 시 상태 확정, C1).
CREATE TABLE attendance_setting (
  setting_id                 SMALLINT PRIMARY KEY DEFAULT 1,
  late_grace_minutes         INTEGER  NOT NULL DEFAULT 10,
  early_leave_grace_minutes  INTEGER  NOT NULL DEFAULT 10,
  CONSTRAINT ck_attendance_setting_single CHECK (setting_id = 1),
  CONSTRAINT ck_attendance_setting_late CHECK (late_grace_minutes BETWEEN 0 AND 240),
  CONSTRAINT ck_attendance_setting_early CHECK (early_leave_grace_minutes BETWEEN 0 AND 240)
);
COMMENT ON COLUMN attendance_setting.late_grace_minutes IS '입실 시각 > 수업 시작 + 이 값(분) 이면 LATE';
COMMENT ON COLUMN attendance_setting.early_leave_grace_minutes IS '퇴실 시각 < 수업 종료 − 이 값(분) 이면 PRESENT → EARLY_LEAVE';
INSERT INTO attendance_setting (setting_id) VALUES (1);

-- Down Migration
DROP TABLE attendance_setting;
