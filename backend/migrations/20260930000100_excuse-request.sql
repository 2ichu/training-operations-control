-- Up Migration
-- 공결(사유결석) 신청·승인: 행정실/교강사가 증빙서류(진단서·예비군 통지서·면접 확인서 등)를 확인해 승인하면 해당 회차 출결이 "인정결석"이 된다.
-- 화면 S30 을 추가한다(S28·S29 와 같은 방식으로 화면 ID CHECK 를 S30 까지 넓힘).
ALTER TABLE role_permission DROP CONSTRAINT ck_role_permission_screen_id;
ALTER TABLE role_permission ADD CONSTRAINT ck_role_permission_screen_id CHECK (screen_id ~ '^S(0[1-9]|[12][0-9]|30)$');

CREATE TABLE excuse_request (
  request_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trainee_id     BIGINT        NOT NULL REFERENCES trainee (trainee_id),
  schedule_id    BIGINT        NOT NULL REFERENCES class_schedule (schedule_id),
  course_id      BIGINT        NOT NULL REFERENCES course (course_id),
  reason_type    VARCHAR(20)   NOT NULL,
  reason_note    VARCHAR(500),
  status         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  requested_by   BIGINT        NOT NULL REFERENCES user_account (user_id),
  requested_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  decided_by     BIGINT        REFERENCES user_account (user_id),
  decided_at     TIMESTAMPTZ,
  decision_note  VARCHAR(500),
  attendance_id  BIGINT        REFERENCES attendance (attendance_id),
  CONSTRAINT ck_excuse_request_reason_type CHECK (reason_type IN ('MEDICAL', 'MILITARY', 'INTERVIEW', 'FAMILY_EVENT', 'OTHER')),
  CONSTRAINT ck_excuse_request_status CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT ck_excuse_request_decision CHECK ((status = 'PENDING') = (decided_at IS NULL AND decided_by IS NULL))
);
COMMENT ON COLUMN excuse_request.reason_type IS 'MEDICAL 병원 진단 / MILITARY 예비군·민방위 / INTERVIEW 면접 / FAMILY_EVENT 경조사 / OTHER 기타';
-- 같은 훈련생·회차에 대기 중이거나 승인된 신청은 하나만(반려된 뒤에는 다시 신청할 수 있다)
CREATE UNIQUE INDEX uq_excuse_request_active ON excuse_request (trainee_id, schedule_id) WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX idx_excuse_request_course_status ON excuse_request (course_id, status, requested_at DESC);

CREATE TABLE excuse_evidence (
  evidence_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id   BIGINT        NOT NULL REFERENCES excuse_request (request_id),
  file_name    VARCHAR(255)  NOT NULL,
  file_path    VARCHAR(500)  NOT NULL,
  file_size    BIGINT        NOT NULL CHECK (file_size > 0),
  mime_type    VARCHAR(100)  NOT NULL,
  uploaded_by  BIGINT        NOT NULL REFERENCES user_account (user_id),
  uploaded_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX idx_excuse_evidence_request ON excuse_evidence (request_id);
-- 증빙 원본은 삭제·수정하지 않는다(append-only)
CREATE TRIGGER trg_excuse_evidence_no_update_delete BEFORE UPDATE OR DELETE ON excuse_evidence
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER trg_excuse_evidence_no_truncate BEFORE TRUNCATE ON excuse_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();

-- Down Migration
DROP TABLE excuse_evidence;
DROP TABLE excuse_request;
DELETE FROM role_permission WHERE screen_id = 'S30';
ALTER TABLE role_permission DROP CONSTRAINT ck_role_permission_screen_id;
ALTER TABLE role_permission ADD CONSTRAINT ck_role_permission_screen_id CHECK (screen_id ~ '^S(0[1-9]|1[0-9]|2[0-9])$');
