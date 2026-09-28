-- Up Migration
CREATE TABLE trainee (
  trainee_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          VARCHAR(50) NOT NULL,
  birth_date    DATE,
  contact       VARCHAR(50),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES user_account (user_id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES user_account (user_id)
);
CREATE INDEX idx_trainee_name_birth ON trainee (name, birth_date);
CREATE TRIGGER trg_trainee_updated_at BEFORE UPDATE ON trainee
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE trainee_enrollment (
  enrollment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trainee_id    BIGINT            NOT NULL REFERENCES trainee (trainee_id),
  course_id     BIGINT            NOT NULL REFERENCES course (course_id),
  status        enrollment_status NOT NULL DEFAULT 'APPLIED',
  applied_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  confirmed_at  TIMESTAMPTZ,
  confirmed_by  BIGINT REFERENCES user_account (user_id),
  cancel_reason VARCHAR(500),
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES user_account (user_id),
  updated_at    TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES user_account (user_id),
  CONSTRAINT uq_trainee_enrollment_trainee_course UNIQUE (trainee_id, course_id)
);
CREATE INDEX idx_trainee_enrollment_course_status ON trainee_enrollment (course_id, status);
CREATE TRIGGER trg_trainee_enrollment_updated_at BEFORE UPDATE ON trainee_enrollment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- entity_id 는 entity_type 에 따라 trainee_id 또는 enrollment_id 를 가리키는 다형성 참조(FK 없음, 앱에서 검증)
CREATE TABLE trainee_change_log (
  log_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type  trainee_change_entity NOT NULL,
  entity_id    BIGINT       NOT NULL,
  changed_by   BIGINT       NOT NULL REFERENCES user_account (user_id),
  changed_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  before_value JSONB        NOT NULL,
  after_value  JSONB        NOT NULL,
  reason       VARCHAR(500) NOT NULL
);
CREATE INDEX idx_trainee_change_log_entity ON trainee_change_log (entity_type, entity_id, changed_at);
CREATE TRIGGER trg_trainee_change_log_no_update_delete BEFORE UPDATE OR DELETE ON trainee_change_log
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_trainee_change_log_no_truncate BEFORE TRUNCATE ON trainee_change_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE trainee_change_log;
DROP TABLE trainee_enrollment;
DROP TABLE trainee;
