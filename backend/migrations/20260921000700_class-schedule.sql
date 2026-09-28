-- Up Migration
-- status 는 예정/휴강만 저장한다. "진행완료"는 계산값(baseline 3-6).
CREATE TABLE class_schedule (
  schedule_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id     BIGINT          NOT NULL REFERENCES course (course_id),
  round_no      INT             NOT NULL,
  class_date    DATE            NOT NULL,
  start_time    TIME            NOT NULL,
  end_time      TIME            NOT NULL,
  instructor_id BIGINT          NOT NULL REFERENCES instructor (instructor_id),
  content       VARCHAR(500),
  status        schedule_status NOT NULL DEFAULT 'SCHEDULED',
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by    BIGINT REFERENCES user_account (user_id),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES user_account (user_id),
  CONSTRAINT uq_class_schedule_course_round UNIQUE (course_id, round_no)
);
CREATE INDEX idx_class_schedule_class_date ON class_schedule (class_date);
CREATE INDEX idx_class_schedule_instructor_date ON class_schedule (instructor_id, class_date);
CREATE TRIGGER trg_class_schedule_updated_at BEFORE UPDATE ON class_schedule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE class_schedule;
