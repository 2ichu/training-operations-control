-- Up Migration
-- Phase 2: 회차별 운영일지(S17)·특이사항(S18). baseline 3-7·3-8, 5-2, 7-8절, system-design STEP 5.3 #11·#12.
-- 두 테이블 모두 ERD 그대로 created_at/by·updated_at/by 가 없다(운영일지=author_id/written_at, 특이사항=reported_by/reported_at
-- 가 그 역할을 대신하고, 수정 추적은 audit_log before/after 만으로 충분하다 — baseline 7절 #17·#18, 전용 change_log 없음).

CREATE TABLE operation_log (
  operation_log_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id       BIGINT      NOT NULL REFERENCES class_schedule (schedule_id),
  instructor_id     BIGINT      NOT NULL REFERENCES instructor (instructor_id),
  content           TEXT        NOT NULL,
  participant_count INT         NOT NULL,
  issue_note        TEXT,
  author_id         BIGINT      NOT NULL REFERENCES user_account (user_id),
  written_at        TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_operation_log_schedule UNIQUE (schedule_id),
  CONSTRAINT ck_operation_log_participant_count CHECK (participant_count >= 0)
);
COMMENT ON CONSTRAINT uq_operation_log_schedule ON operation_log IS '회차당 운영일지 1건(baseline 확정). "미작성"은 행이 없는 계산 상태';
CREATE INDEX idx_operation_log_instructor ON operation_log (instructor_id);

CREATE TYPE course_issue_category AS ENUM ('FACILITY', 'COMPLAINT', 'SAFETY', 'OTHER');
CREATE TYPE course_issue_status AS ENUM ('REGISTERED', 'IN_REVIEW', 'RESOLVED');

CREATE TABLE course_issue (
  issue_id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id   BIGINT                NOT NULL REFERENCES course (course_id),
  schedule_id BIGINT REFERENCES class_schedule (schedule_id),
  category    course_issue_category NOT NULL,
  content     TEXT                  NOT NULL,
  status      course_issue_status   NOT NULL DEFAULT 'REGISTERED',
  reported_by BIGINT                NOT NULL REFERENCES user_account (user_id),
  reported_at TIMESTAMPTZ           NOT NULL
);
CREATE INDEX idx_course_issue_course_status ON course_issue (course_id, status);

-- Down Migration
DROP TABLE course_issue;
DROP TYPE course_issue_status;
DROP TYPE course_issue_category;
DROP TABLE operation_log;
