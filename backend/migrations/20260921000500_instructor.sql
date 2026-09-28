-- Up Migration
CREATE TABLE instructor (
  instructor_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(50)       NOT NULL,
  contact       VARCHAR(50),
  status        instructor_status NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES user_account (user_id),
  updated_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES user_account (user_id)
);
CREATE INDEX idx_instructor_status ON instructor (status);
CREATE TRIGGER trg_instructor_updated_at BEFORE UPDATE ON instructor
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- user_account 와 instructor 의 순환 참조 해소. 강사 1인 1계정(NULL 은 중복 허용)
ALTER TABLE user_account
  ADD CONSTRAINT fk_user_account_linked_instructor FOREIGN KEY (linked_instructor_id) REFERENCES instructor (instructor_id),
  ADD CONSTRAINT uq_user_account_linked_instructor UNIQUE (linked_instructor_id);

CREATE TABLE instructor_assignment (
  assignment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instructor_id BIGINT            NOT NULL REFERENCES instructor (instructor_id),
  course_id     BIGINT            NOT NULL REFERENCES course (course_id),
  round_no      INT,
  status        assignment_status NOT NULL DEFAULT 'ASSIGNED',
  assigned_at   TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES user_account (user_id),
  updated_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES user_account (user_id),
  CONSTRAINT uq_instructor_assignment_key UNIQUE (instructor_id, course_id, round_no)
);
COMMENT ON COLUMN instructor_assignment.round_no IS 'NULL = 과정 전체 담당';
-- 과정 전체 담당(round_no NULL)은 유효 배정 기준 course 당 1건 (baseline 2절: 부분 유니크 요구사항)
CREATE UNIQUE INDEX uq_instructor_assignment_course_wide
  ON instructor_assignment (course_id) WHERE round_no IS NULL AND status = 'ASSIGNED';
CREATE INDEX idx_instructor_assignment_course_status ON instructor_assignment (course_id, status);
CREATE TRIGGER trg_instructor_assignment_updated_at BEFORE UPDATE ON instructor_assignment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- entity_id 는 entity_type 에 따라 instructor_id 또는 assignment_id 를 가리키는 다형성 참조(FK 없음, 앱에서 검증)
CREATE TABLE instructor_change_log (
  log_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type  instructor_change_entity NOT NULL,
  entity_id    BIGINT       NOT NULL,
  changed_by   BIGINT       NOT NULL REFERENCES user_account (user_id),
  changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  before_value JSONB        NOT NULL,
  after_value  JSONB        NOT NULL,
  reason       VARCHAR(500) NOT NULL
);
CREATE INDEX idx_instructor_change_log_entity ON instructor_change_log (entity_type, entity_id, changed_at);
CREATE TRIGGER trg_instructor_change_log_no_update_delete BEFORE UPDATE OR DELETE ON instructor_change_log
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_instructor_change_log_no_truncate BEFORE TRUNCATE ON instructor_change_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE instructor_change_log;
DROP TABLE instructor_assignment;
ALTER TABLE user_account
  DROP CONSTRAINT uq_user_account_linked_instructor,
  DROP CONSTRAINT fk_user_account_linked_instructor;
DROP TABLE instructor;
