-- Up Migration
-- Phase 2: 출결(attendance). baseline 2-1·3-3, system-design STEP 5.3 #9·#10, C1(실제 이벤트 발생 시에만 생성, 미출결은 계산값).
CREATE TYPE attendance_status AS ENUM ('PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'EXCUSED');
CREATE TYPE attendance_source_type AS ENUM ('OFFICIAL', 'MANUAL', 'LINKED');
-- audit_actor_type(4종)과 달리 SYSTEM_RULE 이 없다 — 탐지 규칙은 attendance 를 직접 바꾸지 않는다(system-design STEP 5.3 #10).
CREATE TYPE attendance_change_actor_type AS ENUM ('USER', 'SYSTEM_BATCH', 'SYSTEM_API');

CREATE TABLE attendance (
  attendance_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trainee_id        BIGINT                 NOT NULL REFERENCES trainee (trainee_id),
  schedule_id       BIGINT                 NOT NULL REFERENCES class_schedule (schedule_id),
  check_in_time     TIMESTAMPTZ,
  check_out_time    TIMESTAMPTZ,
  attendance_status attendance_status      NOT NULL,
  source_type       attendance_source_type NOT NULL,
  related_info      JSONB,
  last_modified_at  TIMESTAMPTZ,
  CONSTRAINT uq_attendance_trainee_schedule UNIQUE (trainee_id, schedule_id)
);
COMMENT ON COLUMN attendance.last_modified_at IS 'S09 정정(correct) 시에만 채움(낙관적 잠금 기준). 최초 생성·퇴실 최초기록은 채우지 않는다(C1: 생성과 수정의 구분)';
CREATE INDEX idx_attendance_schedule ON attendance (schedule_id);
CREATE INDEX idx_attendance_trainee ON attendance (trainee_id);
-- hard delete 금지(baseline 8절)는 course·trainee·instructor 등 다른 테이블과 동일하게 애플리케이션 계층에서만 강제한다(DB 트리거 없음).
-- attendance 자체는 append-only 가 아니다(S09 정정은 UPDATE 허용, 이력은 attendance_change_log 가 보존).

CREATE TABLE attendance_change_log (
  log_id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_id BIGINT       NOT NULL REFERENCES attendance (attendance_id),
  trainee_id    BIGINT       NOT NULL REFERENCES trainee (trainee_id),
  actor_type    attendance_change_actor_type NOT NULL,
  changed_by    BIGINT REFERENCES user_account (user_id),
  changed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  before_value  JSONB        NOT NULL,
  after_value   JSONB        NOT NULL,
  reason        VARCHAR(500) NOT NULL,
  CONSTRAINT ck_attendance_change_log_actor_user_required CHECK (actor_type <> 'USER' OR changed_by IS NOT NULL),
  CONSTRAINT ck_attendance_change_log_actor_system_null CHECK (actor_type = 'USER' OR changed_by IS NULL)
);
COMMENT ON COLUMN attendance_change_log.trainee_id IS '비정규화(규칙 05·06 집계 성능용, system-design STEP 5.3 #10)';
CREATE INDEX idx_attendance_change_log_attendance ON attendance_change_log (attendance_id, changed_at);
CREATE INDEX idx_attendance_change_log_trainee ON attendance_change_log (trainee_id, changed_at);
CREATE TRIGGER trg_attendance_change_log_no_update_delete BEFORE UPDATE OR DELETE ON attendance_change_log
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_attendance_change_log_no_truncate BEFORE TRUNCATE ON attendance_change_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE attendance_change_log;
DROP TABLE attendance;
DROP TYPE attendance_change_actor_type;
DROP TYPE attendance_source_type;
DROP TYPE attendance_status;
