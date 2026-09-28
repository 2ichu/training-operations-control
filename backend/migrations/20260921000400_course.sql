-- Up Migration
CREATE TABLE course (
  course_id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_name     VARCHAR(200)  NOT NULL,
  start_date      DATE          NOT NULL,
  end_date        DATE          NOT NULL,
  total_hours     INT           NOT NULL,
  training_site   VARCHAR(200)  NOT NULL,
  manager_user_id BIGINT        NOT NULL REFERENCES user_account (user_id),
  status          course_status NOT NULL DEFAULT 'PREPARING',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by      BIGINT REFERENCES user_account (user_id),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_by      BIGINT REFERENCES user_account (user_id),
  CONSTRAINT ck_course_dates CHECK (end_date >= start_date),
  CONSTRAINT ck_course_total_hours CHECK (total_hours > 0)
);
CREATE INDEX idx_course_status ON course (status);
CREATE INDEX idx_course_period ON course (start_date, end_date);
CREATE TRIGGER trg_course_updated_at BEFORE UPDATE ON course
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE course;
